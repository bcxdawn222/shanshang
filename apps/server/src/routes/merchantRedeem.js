import { writeAudit } from '../lib/audit.js';
import { requireAccount } from '../lib/guards.js';
import { HttpError } from '../lib/http.js';
import { VALID_SQL, imagePath, publicState } from '../lib/snapshots.js';
import { recordRedeem } from '../lib/stats.js';

// { code } 或 { token } 二选一
const targetBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 1,
  properties: {
    code: { type: 'string', pattern: '^\\d{6}$' },
    token: { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' },
  },
};

const pageQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
};

const notFound = () => new HttpError(404, 'SNAPSHOT_NOT_FOUND', '快照不存在，请核对短码');
const redeemedError = () => new HttpError(409, 'SNAPSHOT_REDEEMED', '该优惠已核销，不能重复核销');
const expiredError = () => new HttpError(410, 'SNAPSHOT_EXPIRED', '该优惠已过期或已作废');
const pendingError = () => new HttpError(409, 'SNAPSHOT_PENDING', '照片还在生成中，请稍后再查');

/**
 * 商家核销（Phase 5 §4）：只能查、核自己服饰的快照，跨商家统一 404，不泄露是否存在。
 * 查询和核销共用每账号每分钟 20 次限流，防止穷举短码。
 */
export default async function merchantRedeemRoutes(app, { ctx }) {
  const { db, config, now, limiters } = ctx;
  app.addHook('preValidation', requireAccount('merchant', { approved: true }));

  const base = `SELECT s.*, g.title AS garment_title FROM snapshot s JOIN garment g ON g.id = s.garment_id`;
  const byToken = db.prepare(`${base} WHERE s.merchant_id = @m AND s.token = @token`);
  // 同一短码可能对应多条历史快照（只在未核销且未过期的快照里唯一）：优先可核销的，其次未过期的，再按最新
  const byCode = db.prepare(
    `${base} WHERE s.merchant_id = @m AND s.code = @code
      ORDER BY CASE WHEN ${VALID_SQL} THEN 0 WHEN s.redeemed_at IS NULL AND s.expires_at > @now THEN 1 ELSE 2 END,
               s.id DESC
      LIMIT 1`,
  );
  const byId = db.prepare(`${base} WHERE s.id = ?`);

  function find(request) {
    if (!limiters.redeemLookup.hit(String(request.account.id))) {
      throw new HttpError(429, 'TOO_MANY_REQUESTS', '查询过于频繁，请 1 分钟后再试');
    }
    const m = request.account.id;
    const { code, token } = request.body;
    const row = token ? byToken.get({ m, token }) : byCode.get({ m, code, now: now() });
    if (!row) throw notFound();
    return row;
  }

  const view = (row, t) => ({
    id: row.id,
    code: row.code,
    garmentTitle: row.garment_title,
    imageUrl: imagePath(config, row, t),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
    state: publicState(row, t),
  });

  app.post('/merchant/redeem/lookup', { schema: { body: targetBody } }, async (request) => view(find(request), now()));

  app.post('/merchant/redeem', { schema: { body: targetBody } }, async (request) => {
    const row = find(request);
    const t = now();
    const check = (r) => {
      const state = publicState(r, t);
      if (state === 'redeemed') throw redeemedError();
      if (state === 'expired') throw expiredError();
      if (state === 'pending') throw pendingError();
    };
    check(row);
    // 条件 UPDATE：并发核销时只有一个请求能改到行，另一个按最新状态报 409
    const changed = db.transaction(() => {
      const r = db
        .prepare(
          `UPDATE snapshot AS s SET redeemed_at = @t, redeemed_by = @by
            WHERE s.id = @id AND s.merchant_id = @by AND ${VALID_SQL}`,
        )
        .run({ t, by: request.account.id, id: row.id, now: t });
      if (!r.changes) return false;
      writeAudit(db, {
        actorId: request.account.id,
        action: 'snapshot.redeem',
        targetType: 'snapshot',
        targetId: row.id,
        detail: { code: row.code, garmentId: row.garment_id },
        ip: request.ip,
        now: t,
      });
      // Phase 7：核销件数计入 stat_daily（核销当天 × 服饰所属商家 × 快照来源设备）
      recordRedeem(db, { merchantId: row.merchant_id, garmentId: row.garment_id, deviceId: row.device_id, now: t });
      return true;
    })();
    const fresh = byId.get(row.id);
    if (!changed) {
      check(fresh);
      throw redeemedError();
    }
    return view(fresh, t);
  });

  // 核销记录：只看自己已核销的
  app.get('/merchant/redemptions', { schema: { querystring: pageQuery } }, async (request) => {
    const { page, pageSize } = request.query;
    const m = request.account.id;
    const total = db
      .prepare('SELECT COUNT(*) FROM snapshot WHERE merchant_id = ? AND redeemed_at IS NOT NULL')
      .pluck()
      .get(m);
    const items = db
      .prepare(
        `${base} WHERE s.merchant_id = ? AND s.redeemed_at IS NOT NULL
          ORDER BY s.redeemed_at DESC, s.id DESC LIMIT ? OFFSET ?`,
      )
      .all(m, pageSize, (page - 1) * pageSize)
      .map((r) => ({ id: r.id, code: r.code, garmentTitle: r.garment_title, createdAt: r.created_at, redeemedAt: r.redeemed_at }));
    return { items, total };
  });
}
