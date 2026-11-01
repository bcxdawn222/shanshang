import QRCode from 'qrcode';
import { deviceGarments } from '../lib/garments.js';
import { HttpError, isUniqueViolation } from '../lib/http.js';
import { detectImage } from '../lib/images.js';
import {
  ACTIVE_SQL,
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_TTL_MS,
  UPLOAD_WINDOW_MS,
  newSnapshotToken,
  randomSnapshotCode,
  snapshotUrl,
} from '../lib/snapshots.js';
import { sha256 } from '../lib/tokens.js';

const reserveBody = {
  type: 'object',
  required: ['garmentId'],
  additionalProperties: false,
  properties: { garmentId: { type: 'integer', minimum: 1 } },
};

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

/** 读取 multipart 里名为 image 的图片，单张上限 maxBytes（超限 413） */
async function readSnapshotImage(request, maxBytes) {
  if (!request.isMultipart()) throw new HttpError(400, 'BAD_REQUEST', '请用表单上传');
  let file = null;
  try {
    for await (const part of request.parts({ limits: { fileSize: maxBytes } })) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      if (part.fieldname === 'image' && !file) file = buf;
    }
  } catch (error) {
    if (error.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'FILE_TOO_LARGE', '图片不能超过 5MB');
    throw error;
  }
  return file;
}

const expiredError = () => new HttpError(410, 'SNAPSHOT_EXPIRED', '快照已过期或已作废，请重新领取');
const imageExistsError = () => new HttpError(409, 'SNAPSHOT_IMAGE_EXISTS', '该快照已上传过图片');

/**
 * 设备快照接口（Phase 5 §2）：先预约拿短码 + 链接 + 二维码，Canvas 合成后再上传图片。
 * 设备鉴权口径与 routes/device.js 一致：Bearer 设备令牌，必须已绑定。
 */
export default async function deviceSnapshotRoutes(app, { ctx }) {
  const { db, config, now, storage, limiters, uploadLimits } = ctx;
  const maxBytes = uploadLimits.snapshot ?? SNAPSHOT_MAX_BYTES;

  async function deviceAuth(request) {
    const match = /^Bearer\s+(\S+)$/.exec(request.headers.authorization ?? '');
    if (!match) throw new HttpError(401, 'DEVICE_UNAUTHENTICATED', '缺少设备凭证');
    const device = db.prepare('SELECT * FROM device WHERE secret_hash = ?').get(sha256(match[1]));
    if (!device) throw new HttpError(401, 'DEVICE_UNAUTHENTICATED', '设备凭证无效');
    db.prepare('UPDATE device SET last_seen_at = ? WHERE id = ?').run(now(), device.id);
    if (device.status !== 'bound') throw new HttpError(403, 'DEVICE_NOT_BOUND', '设备未绑定或已停用');
    request.device = device;
  }

  const codeTaken = db.prepare(`SELECT 1 FROM snapshot s WHERE s.code = @code AND ${ACTIVE_SQL}`);
  const insert = db.prepare(
    `INSERT INTO snapshot (token, code, garment_id, merchant_id, device_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  // 预约：服饰需对本设备可见（与设备服饰清单同一口径），否则 404
  app.post(
    '/device/snapshots',
    { preValidation: deviceAuth, schema: { body: reserveBody } },
    async (request, reply) => {
      const device = request.device;
      if (!limiters.snapshotReserve.hit(String(device.id))) {
        throw new HttpError(429, 'TOO_MANY_REQUESTS', '领取过于频繁，请稍后再试');
      }
      const t = now();
      const garment = deviceGarments(db, t).find((g) => g.id === request.body.garmentId);
      if (!garment) throw new HttpError(404, 'GARMENT_NOT_FOUND', '服饰不存在或已下架');

      const expiresAt = t + SNAPSHOT_TTL_MS;
      let created = null;
      for (let attempt = 0; attempt < 20 && !created; attempt += 1) {
        const code = randomSnapshotCode();
        const token = newSnapshotToken();
        // 查重和插入在同一事务里（better-sqlite3 同步执行，事务内不会被其他请求插队）
        created = db.transaction(() => {
          if (codeTaken.get({ code, now: t, voidBefore: t - UPLOAD_WINDOW_MS })) return null;
          try {
            const r = insert.run(token, code, garment.id, garment.merchantId, device.id, t, expiresAt);
            return { id: Number(r.lastInsertRowid), code, token };
          } catch (error) {
            if (isUniqueViolation(error)) return null;
            throw error;
          }
        })();
      }
      if (!created) throw new HttpError(503, 'CODE_EXHAUSTED', '短码生成失败，请稍后再试');

      const url = snapshotUrl(config, request, created.token);
      // 纯 SVG 路径，不含外部引用，设备直接插入
      const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      request.log.info({ deviceId: device.id, snapshotId: created.id }, 'snapshot reserved');
      reply.code(201);
      return { id: created.id, code: created.code, url, qrSvg, expiresAt };
    },
  );

  // 上传合成图：只能传本设备预约的快照、只能传一次、预约 10 分钟内
  app.put(
    '/device/snapshots/:id/image',
    { preValidation: deviceAuth, schema: { params: idParams } },
    async (request) => {
      const load = () =>
        db.prepare('SELECT * FROM snapshot WHERE id = ? AND device_id = ?').get(request.params.id, request.device.id);
      const check = (row, t) => {
        if (!row) throw new HttpError(404, 'SNAPSHOT_NOT_FOUND', '快照不存在');
        if (row.image_key) throw imageExistsError();
        if (row.purged_at || row.expires_at <= t || row.created_at + UPLOAD_WINDOW_MS <= t) throw expiredError();
      };
      check(load(), now());

      const file = await readSnapshotImage(request, maxBytes);
      if (!file?.length) throw new HttpError(400, 'BAD_REQUEST', '请选择图片');
      const image = detectImage(file);
      if (!image) throw new HttpError(400, 'UNSUPPORTED_MEDIA', '只支持 JPG、PNG、WebP 图片');

      const key = await storage.put('snapshots', file, image.ext);
      const t = now();
      // 条件更新防并发重复上传：只有还没图、未清理、仍在上传窗口内才写入
      const r = db
        .prepare(
          `UPDATE snapshot SET image_key = ?
            WHERE id = ? AND image_key IS NULL AND purged_at IS NULL AND created_at > ? AND expires_at > ?`,
        )
        .run(key, request.params.id, t - UPLOAD_WINDOW_MS, t);
      if (!r.changes) {
        await storage.remove(key).catch(() => {});
        check(load(), t);
        throw imageExistsError();
      }
      const row = load();
      return { id: row.id, code: row.code, url: snapshotUrl(config, request, row.token), expiresAt: row.expires_at };
    },
  );
}
