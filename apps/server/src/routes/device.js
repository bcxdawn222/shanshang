import { HttpError, isUniqueViolation } from '../lib/http.js';
import { randomCode, randomToken, sha256 } from '../lib/tokens.js';

/**
 * 设备接口。设备开机先 register 拿到 code（屏幕显示）和设备令牌（本地保存）；
 * 管理员按 code 绑定后，设备凭令牌换 Xmax 临时密钥。未绑定、已停用设备一律拒绝（DVC-02）。
 */
export default async function deviceRoutes(app, { ctx }) {
  const { db, config, now, fetchImpl, limiters } = ctx;

  app.post('/device/register', async (request, reply) => {
    if (!limiters.deviceRegister.hit(request.ip)) {
      throw new HttpError(429, 'TOO_MANY_REQUESTS', '设备注册过于频繁，请稍后再试');
    }
    const token = randomToken();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomCode(8);
      try {
        db.prepare(
          "INSERT INTO device (code, secret_hash, status, created_at) VALUES (?, ?, 'pending', ?)",
        ).run(code, sha256(token), now());
        reply.code(201);
        return { code, token };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new HttpError(500, 'INTERNAL', '生成设备码失败，请重试');
  });

  async function deviceAuth(request) {
    const match = /^Bearer\s+(\S+)$/.exec(request.headers.authorization ?? '');
    if (!match) throw new HttpError(401, 'DEVICE_UNAUTHENTICATED', '缺少设备凭证');
    const device = db.prepare('SELECT * FROM device WHERE secret_hash = ?').get(sha256(match[1]));
    if (!device) throw new HttpError(401, 'DEVICE_UNAUTHENTICATED', '设备凭证无效');
    db.prepare('UPDATE device SET last_seen_at = ? WHERE id = ?').run(now(), device.id);
    request.device = device;
  }

  // 设备轮询：未绑定时屏幕继续显示设备码
  app.get('/device/status', { preValidation: deviceAuth }, async (request) => {
    const { code, status, name, location } = request.device;
    return { code, status, name, location };
  });

  app.post('/device/xmax-key', { preValidation: deviceAuth }, async (request) => {
    const device = request.device;
    if (device.status !== 'bound') throw new HttpError(403, 'DEVICE_NOT_BOUND', '设备未绑定或已停用');
    const { apiKey, apiBase, keyExpireSeconds, keyPointsLimit } = config.xmax;
    if (!apiKey || !apiBase) throw new HttpError(503, 'XMAX_NOT_CONFIGURED', '服务端未配置 Xmax 密钥');
    if (!limiters.xmaxKey.hit(String(device.id))) {
      throw new HttpError(429, 'TOO_MANY_REQUESTS', '获取试穿密钥过于频繁，请稍后再试');
    }

    let upstream;
    let text;
    try {
      upstream = await fetchImpl(`${apiBase}/temporary-api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({ expireSeconds: keyExpireSeconds, pointsLimit: keyPointsLimit }),
        signal: AbortSignal.timeout(10_000),
      });
      text = await upstream.text();
    } catch (error) {
      request.log.error({ err: error, deviceId: device.id }, 'xmax key request failed');
      throw new HttpError(502, 'XMAX_UPSTREAM_ERROR', '试穿服务暂时不可用');
    }

    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      // 非 JSON 响应按失败处理
    }
    const data = payload?.data ?? payload;
    if (!upstream.ok || !data?.temporaryApiKey) {
      request.log.error({ status: upstream.status, deviceId: device.id }, 'xmax key bad response');
      throw new HttpError(502, 'XMAX_UPSTREAM_ERROR', '试穿服务暂时不可用');
    }

    request.log.info({ deviceId: device.id }, 'xmax temporary key issued');
    return {
      temporaryApiKey: data.temporaryApiKey,
      expireTimestamp: data.expireTimestamp ?? null,
      pointsLimit: data.pointsLimit ?? keyPointsLimit,
    };
  });
}
