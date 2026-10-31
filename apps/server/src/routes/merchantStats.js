import { writeAudit } from '../lib/audit.js';
import { requireAccount } from '../lib/guards.js';
import { HttpError } from '../lib/http.js';
import { WindowLimiter } from '../lib/limiter.js';
import { getSiteExtras } from '../lib/siteExtras.js';
import { queryStats, resolveRange, sendWorkbook, statsWorkbook } from '../lib/stats.js';

const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const rangeQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { from: day, to: day },
};

const pageQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
};

const feedbackBody = {
  type: 'object',
  required: ['content'],
  additionalProperties: false,
  properties: { content: { type: 'string', minLength: 1, maxLength: 500 } },
};

export const feedbackView = (r) => ({
  id: r.id,
  merchantId: r.merchant_id,
  ...(r.brand_name !== undefined ? { brandName: r.brand_name ?? '', username: r.username ?? '' } : {}),
  content: r.content,
  status: r.status,
  reply: r.reply,
  repliedAt: r.replied_at,
  createdAt: r.created_at,
});

/**
 * 商家：数据统计（STA-01、STA-03）、联系我们（SET-06）、留言反馈（SET-07）、打赏码（SET-08）。
 * 一律以登录态里的账号 id 为准，不接受前端传 merchantId。
 */
export default async function merchantStatsRoutes(app, { ctx }) {
  const { db, now } = ctx;
  // 每个商家每小时最多留言 20 条
  const feedbackLimiter = new WindowLimiter({ limit: 20, windowMs: 60 * 60_000, now });
  app.addHook('preValidation', requireAccount('merchant'));
  const approved = { preValidation: requireAccount('merchant', { approved: true }) };

  const stats = (request) => {
    const range = resolveRange(request.query, now());
    return queryStats(db, { from: range.from, to: range.to, merchantId: request.account.id });
  };

  app.get('/merchant/stats', { ...approved, schema: { querystring: rangeQuery } }, async (request) => stats(request));

  app.get('/merchant/stats/export', { ...approved, schema: { querystring: rangeQuery } }, async (request, reply) => {
    const result = stats(request);
    const { from, to } = result.range;
    return sendWorkbook(reply, statsWorkbook(result), `数据统计_${from}_${to}.xls`);
  });

  // 联系我们：待审核商家也能看（审核问题要找平台）
  app.get('/merchant/contact', async () => {
    const { contactPhone, contactAddress, wechatQrUrl } = getSiteExtras(db);
    return { phone: contactPhone, address: contactAddress, wechatQrUrl };
  });

  app.get('/merchant/tip', approved, async () => ({ qrUrl: getSiteExtras(db).tipQrUrl }));

  // 留言反馈：待审核商家也可留言
  app.get('/merchant/feedback', { schema: { querystring: pageQuery } }, async (request) => {
    const { page, pageSize } = request.query;
    const m = request.account.id;
    const total = db.prepare('SELECT COUNT(*) FROM feedback WHERE merchant_id = ?').pluck().get(m);
    const items = db
      .prepare('SELECT * FROM feedback WHERE merchant_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(m, pageSize, (page - 1) * pageSize)
      .map(feedbackView);
    return { items, total };
  });

  app.post('/merchant/feedback', { schema: { body: feedbackBody } }, async (request, reply) => {
    const content = request.body.content.trim();
    if (!content) throw new HttpError(400, 'BAD_REQUEST', '请填写留言内容');
    if (!feedbackLimiter.hit(String(request.account.id))) {
      throw new HttpError(429, 'TOO_MANY_REQUESTS', '留言过于频繁，请稍后再试');
    }
    const t = now();
    const row = db.transaction(() => {
      const r = db
        .prepare("INSERT INTO feedback (merchant_id, content, status, created_at) VALUES (?, ?, 'pending', ?) RETURNING *")
        .get(request.account.id, content, t);
      writeAudit(db, {
        actorId: request.account.id,
        action: 'feedback.create',
        targetType: 'feedback',
        targetId: r.id,
        detail: { length: content.length },
        ip: request.ip,
        now: t,
      });
      return r;
    })();
    reply.code(201);
    return { item: feedbackView(row) };
  });
}
