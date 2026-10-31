import { HttpError } from '../lib/http.js';
import { EVENT_TYPES, ingestEvents } from '../lib/stats.js';
import { sha256 } from '../lib/tokens.js';

const id = { type: 'integer', minimum: 1 };

const eventsBody = {
  type: 'object',
  required: ['sessionId', 'events'],
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,64}$' },
    events: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        required: ['seq', 'type', 'ts'],
        additionalProperties: false,
        properties: {
          seq: { type: 'integer', minimum: 0 },
          type: { type: 'string', enum: EVENT_TYPES },
          // 设备时间（毫秒）；偏差过大时服务端改用收到的时间
          ts: { type: 'integer', minimum: 0 },
          merchantId: id,
          garmentId: id,
          garmentIds: { type: 'array', maxItems: 50, items: id },
          snapshotId: id,
          // 上报原值，汇总时按口径截断（品牌停留、试穿单次 10 分钟）
          durationMs: { type: 'integer', minimum: 0, maximum: 24 * 3600_000 },
          questionKey: { type: 'string', maxLength: 64 },
        },
      },
    },
  },
};

/**
 * 设备埋点上报（STA-01）：每批 1~50 条，按 device_id + session_id + seq 去重，入库同时累加 stat_daily。
 * 不扣费（扣费只走 /device/tryon/segments）。鉴权口径与 routes/device.js 一致：Bearer 设备令牌，必须已绑定。
 */
export default async function deviceEventRoutes(app, { ctx }) {
  const { db, now } = ctx;

  async function deviceAuth(request) {
    const match = /^Bearer\s+(\S+)$/.exec(request.headers.authorization ?? '');
    if (!match) throw new HttpError(401, 'DEVICE_UNAUTHENTICATED', '缺少设备凭证');
    const device = db.prepare('SELECT * FROM device WHERE secret_hash = ?').get(sha256(match[1]));
    if (!device) throw new HttpError(401, 'DEVICE_UNAUTHENTICATED', '设备凭证无效');
    db.prepare('UPDATE device SET last_seen_at = ? WHERE id = ?').run(now(), device.id);
    if (device.status !== 'bound') throw new HttpError(403, 'DEVICE_NOT_BOUND', '设备未绑定或已停用');
    request.device = device;
  }

  app.post('/device/events', { preValidation: deviceAuth, schema: { body: eventsBody } }, async (request) =>
    ingestEvents(db, {
      deviceId: request.device.id,
      sessionId: request.body.sessionId,
      events: request.body.events,
      now: now(),
    }),
  );
}
