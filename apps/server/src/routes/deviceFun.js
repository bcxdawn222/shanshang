import { deviceFunConfig } from '../lib/fun.js';
import { HttpError } from '../lib/http.js';
import { sha256 } from '../lib/tokens.js';

/**
 * 设备玩法配置（Phase 6）：星座轮盘、AI 推荐选项、运势文案库。
 * 鉴权口径与 routes/device.js 一致：Bearer 设备令牌，必须已绑定。
 * 未配置的字段为 null，设备用 packages/shared 的默认值。
 */
export default async function deviceFunRoutes(app, { ctx }) {
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

  app.get('/device/fun/config', { preValidation: deviceAuth }, async () => deviceFunConfig(db));
}
