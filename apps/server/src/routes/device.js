import { deviceDramas, deviceHot, devicePlaylist } from '../lib/ads.js';
import { deviceGarments } from '../lib/garments.js';
import { HttpError, isUniqueViolation } from '../lib/http.js';
import { consumeSegments, getPointsConfig } from '../lib/points.js';
import { getSettings } from '../lib/settings.js';
import { randomCode, randomToken, sha256 } from '../lib/tokens.js';
import { issueTemporaryKey } from '../lib/xmax.js';

// 单段离屏时长上限 10 分钟；超出直接 400，不截断
const MAX_SEGMENT_MS = 600_000;

const segmentsBody = {
  type: 'object',
  required: ['sessionId', 'segments'],
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$' },
    segments: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        required: ['seq', 'garmentId', 'durationMs'],
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', minimum: 0 },
          garmentId: { type: 'integer', minimum: 1 },
          durationMs: { type: 'integer', minimum: 0, maximum: MAX_SEGMENT_MS },
        },
      },
    },
  },
};

/**
 * 设备接口。设备开机先 register 拿到 code（屏幕显示）和设备令牌（本地保存）；
 * 管理员按 code 绑定后，设备凭令牌换 Xmax 临时密钥、拉服饰清单。未绑定、已停用设备一律拒绝（DVC-02）。
 */
export default async function deviceRoutes(app, { ctx }) {
  const { db, config, now, limiters } = ctx;

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

  function requireBound(request) {
    if (request.device.status !== 'bound') throw new HttpError(403, 'DEVICE_NOT_BOUND', '设备未绑定或已停用');
  }

  // 设备轮询：未绑定时屏幕继续显示设备码
  app.get('/device/status', { preValidation: deviceAuth }, async (request) => {
    const { code, status, name, location, background } = request.device;
    return { code, status, name, location, background };
  });

  // 心跳：每 30 秒一次。未绑定也可调，只更新 last_seen（deviceAuth 里已更新）
  app.post('/device/heartbeat', { preValidation: deviceAuth }, async (request) => ({
    ok: true,
    background: request.device.background,
    serverTime: now(),
  }));

  // 设备前台配置：平台名、Logo、背景、单次试穿上限、无操作进入待机的分钟数
  app.get('/device/config', { preValidation: deviceAuth }, async (request) => {
    requireBound(request);
    const { platformName, logoUrl } = getSettings(db);
    const { tryonMaxMinutes, idleMinutes } = getPointsConfig(db);
    return { platformName, logoUrl, background: request.device.background, tryonMaxMinutes, idleMinutes };
  });

  // 离屏时长上报：按 device_id + session_id + seq 幂等扣费到服饰所属商家，允许透支
  app.post(
    '/device/tryon/segments',
    { preValidation: deviceAuth, schema: { body: segmentsBody } },
    async (request) => {
      requireBound(request);
      return consumeSegments(db, {
        deviceId: request.device.id,
        sessionId: request.body.sessionId,
        segments: request.body.segments,
        now: now(),
      });
    },
  );

  app.post('/device/xmax-key', { preValidation: deviceAuth }, async (request) => {
    requireBound(request);
    const device = request.device;
    if (!config.xmax.apiKey || !config.xmax.apiBase) {
      throw new HttpError(503, 'XMAX_NOT_CONFIGURED', '服务端未配置 Xmax 密钥');
    }
    if (!limiters.xmaxKey.hit(String(device.id))) {
      throw new HttpError(429, 'TOO_MANY_REQUESTS', '获取试穿密钥过于频繁，请稍后再试');
    }
    try {
      const key = await issueTemporaryKey(ctx);
      request.log.info({ deviceId: device.id }, 'xmax temporary key issued');
      return key;
    } catch (error) {
      request.log.error({ code: error.code, deviceId: device.id }, 'xmax key request failed');
      throw error;
    }
  });

  // 设备服饰清单：已上架、审核期已到、商家正常且余额不低于隐藏阈值的服饰。xmaxUrl 为空时设备用官方 SDK 兜底上传 imagePath
  app.get('/device/garments', { preValidation: deviceAuth }, async (request) => {
    requireBound(request);
    return { items: deviceGarments(db, now()) };
  });

  // 待机播放列表：本设备有配置用本设备的，否则用默认列表；version 为内容哈希
  app.get('/device/playlist', { preValidation: deviceAuth }, async (request) => {
    requireBound(request);
    return devicePlaylist(db, request.device.id);
  });

  // 热门榜：近 7 天试穿次数 + 人工置顶 / 移出，只含设备可见服饰，最多 20 条
  app.get('/device/hot', { preValidation: deviceAuth }, async (request) => {
    requireBound(request);
    return { items: deviceHot(db, now()) };
  });

  // 短剧专题：只返回启用的专题；garmentIds 只保留设备可见服饰，保持专题内顺序
  app.get('/device/dramas', { preValidation: deviceAuth }, async (request) => {
    requireBound(request);
    return { items: deviceDramas(db, now()) };
  });
}
