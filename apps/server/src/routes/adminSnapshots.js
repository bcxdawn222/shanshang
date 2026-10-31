import { requireAccount } from '../lib/guards.js';
import { PENDING_SQL, UPLOAD_WINDOW_MS, VALID_SQL, publicState } from '../lib/snapshots.js';

const listQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    merchantId: { type: 'integer', minimum: 1 },
    state: { type: 'string', enum: ['valid', 'pending', 'redeemed', 'expired'] },
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
};

// 对外 state 的 SQL 口径，与 publicState() 一致：pending 为照片生成中；作废、过期、已清理算 expired
const STATE_SQL = {
  valid: VALID_SQL,
  pending: PENDING_SQL,
  redeemed: '(s.redeemed_at IS NOT NULL)',
  expired: `(s.redeemed_at IS NULL AND NOT ${VALID_SQL} AND NOT ${PENDING_SQL})`,
};

/** 总后台快照列表（Phase 5 §6）：只读，用于排查；不含顾客信息（本来也没有） */
export default async function adminSnapshotRoutes(app, { ctx }) {
  const { db, now } = ctx;
  app.addHook('preValidation', requireAccount('admin'));

  app.get('/admin/snapshots', { schema: { querystring: listQuery } }, async (request) => {
    const { merchantId = null, state, page, pageSize } = request.query;
    const t = now();
    const where = `WHERE (@merchantId IS NULL OR s.merchant_id = @merchantId)${state ? ` AND ${STATE_SQL[state]}` : ''}`;
    const params = { merchantId, now: t, voidBefore: t - UPLOAD_WINDOW_MS };
    const total = db.prepare(`SELECT COUNT(*) FROM snapshot s ${where}`).pluck().get(params);
    const rows = db
      .prepare(
        `SELECT s.*, m.brand_name, g.title AS garment_title, d.name AS device_name
           FROM snapshot s
           LEFT JOIN merchant m ON m.account_id = s.merchant_id
           LEFT JOIN garment g ON g.id = s.garment_id
           LEFT JOIN device d ON d.id = s.device_id
           ${where}
          ORDER BY s.created_at DESC, s.id DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
    const items = rows.map((r) => ({
      id: r.id,
      code: r.code,
      merchantId: r.merchant_id,
      brandName: r.brand_name ?? '',
      garmentId: r.garment_id,
      garmentTitle: r.garment_title ?? '',
      deviceId: r.device_id,
      deviceName: r.device_name ?? '',
      state: publicState(r, t),
      hasImage: Boolean(r.image_key),
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      redeemedAt: r.redeemed_at,
      purgedAt: r.purged_at,
    }));
    return { items, total };
  });
}
