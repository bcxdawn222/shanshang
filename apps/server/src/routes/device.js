import { loadDicts, promoteDue } from '../lib/garments.js';
import { HttpError, isUniqueViolation } from '../lib/http.js';
import { randomCode, randomToken, sha256 } from '../lib/tokens.js';
import { issueTemporaryKey } from '../lib/xmax.js';

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
    const { code, status, name, location } = request.device;
    return { code, status, name, location };
  });

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

  // 设备服饰清单：已上架、审核期已到、商家正常的服饰。xmaxUrl 为空时设备用官方 SDK 兜底上传 imagePath
  app.get('/device/garments', { preValidation: deviceAuth }, async (request) => {
    requireBound(request);
    const t = now();
    promoteDue(db, t);
    const dicts = loadDicts(db);
    const name = (id) => dicts.get(id)?.name ?? '';
    const rows = db
      .prepare(
        `SELECT g.*, m.brand_name, m.shop_location AS merchant_location
           FROM garment g
           JOIN account a ON a.id = g.merchant_id
           JOIN merchant m ON m.account_id = g.merchant_id
          WHERE g.deleted_at IS NULL AND g.status = 'ready' AND g.available_at <= ? AND a.status = 'approved'
          ORDER BY g.merchant_id, g.id`,
      )
      .all(t);
    return {
      items: rows.map((g) => ({
        id: g.id,
        merchantId: g.merchant_id,
        brandName: g.brand_name,
        title: g.title,
        gender: g.gender,
        setType: g.set_type,
        category: name(g.category_id),
        color: name(g.color_id),
        scenes: JSON.parse(g.scene_ids).map(name).filter(Boolean),
        discountText: g.discount_text,
        shopLocation: g.shop_location || g.merchant_location,
        imagePath: `media/${g.image_key}`,
        xmaxUrl: g.xmax_url,
      })),
    };
  });
}
