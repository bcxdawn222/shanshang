import { writeAudit } from '../lib/audit.js';
import { requireAccount } from '../lib/guards.js';
import { HttpError } from '../lib/http.js';
import { detectImage } from '../lib/images.js';
import { getSiteExtras, updateSiteExtras } from '../lib/siteExtras.js';
import { queryStats, resolveRange, sendWorkbook, statsWorkbook } from '../lib/stats.js';
import { feedbackView } from './merchantStats.js';

const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const statsQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: day,
    to: day,
    merchantId: { type: 'integer', minimum: 1 },
    deviceId: { type: 'integer', minimum: 1 },
  },
};

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

const feedbackQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['pending', 'replied'] },
    merchantId: { type: 'integer', minimum: 1 },
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
};

const replyBody = {
  type: 'object',
  required: ['reply'],
  additionalProperties: false,
  properties: { reply: { type: 'string', minLength: 1, maxLength: 500 } },
};

// 空串、站内媒体路径或 http(s) 地址（与收款码同口径）
const qrUrl = { type: 'string', maxLength: 500, pattern: '^(|media/[A-Za-z0-9/._-]+|https?://\\S+)$' };
const extrasBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    contactPhone: { type: 'string', maxLength: 50 },
    contactAddress: { type: 'string', maxLength: 200 },
    wechatQrUrl: qrUrl,
    tipQrUrl: qrUrl,
  },
};

const qrQuery = {
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: { kind: { type: 'string', enum: ['wechat', 'tip'] } },
};
const QR_FIELD = { wechat: 'wechatQrUrl', tip: 'tipQrUrl' };

/** 读取 multipart 里名为 image 的图片 */
async function readImage(request) {
  if (!request.isMultipart()) throw new HttpError(400, 'BAD_REQUEST', '请用表单上传');
  let file = null;
  for await (const part of request.parts()) {
    if (part.type !== 'file') continue;
    const buf = await part.toBuffer();
    if (part.fieldname === 'image' && !file) file = buf;
  }
  return file;
}

/**
 * 总后台：全局数据统计（STA-02、STA-03，可按商家、设备筛选）、留言回复（SET-07）、
 * 站点信息：联系方式、微信二维码、打赏码（SET-06、SET-08、ADM-08）。
 */
export default async function adminStatsRoutes(app, { ctx }) {
  const { db, now, storage } = ctx;
  app.addHook('preValidation', requireAccount('admin'));

  const audit = (request, action, targetType, targetId, detail) =>
    writeAudit(db, { actorId: request.account.id, action, targetType, targetId, detail, ip: request.ip, now: now() });

  const stats = (request) => {
    const range = resolveRange(request.query, now());
    const { merchantId = null, deviceId = null } = request.query;
    return queryStats(db, { from: range.from, to: range.to, merchantId, deviceId, withMerchants: true });
  };

  app.get('/admin/stats', { schema: { querystring: statsQuery } }, async (request) => stats(request));

  app.get('/admin/stats/export', { schema: { querystring: statsQuery } }, async (request, reply) => {
    const result = stats(request);
    const { from, to } = result.range;
    const { merchantId = null, deviceId = null } = request.query;
    audit(request, 'stats.export', 'stats', '', { from, to, merchantId, deviceId });
    return sendWorkbook(reply, statsWorkbook(result, { title: '全局数据统计' }), `全局数据统计_${from}_${to}.xls`);
  });

  // ---------- 留言反馈 ----------

  app.get('/admin/feedback', { schema: { querystring: feedbackQuery } }, async (request) => {
    const { status = null, merchantId = null, page, pageSize } = request.query;
    const where = '(@status IS NULL OR f.status = @status) AND (@merchantId IS NULL OR f.merchant_id = @merchantId)';
    const params = { status, merchantId };
    const total = db.prepare(`SELECT COUNT(*) FROM feedback f WHERE ${where}`).pluck().get(params);
    const pending = db.prepare("SELECT COUNT(*) FROM feedback WHERE status = 'pending'").pluck().get();
    const items = db
      .prepare(
        `SELECT f.*, m.brand_name, a.username
           FROM feedback f
           LEFT JOIN merchant m ON m.account_id = f.merchant_id
           LEFT JOIN account a ON a.id = f.merchant_id
          WHERE ${where}
          ORDER BY CASE f.status WHEN 'pending' THEN 0 ELSE 1 END, f.id DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize })
      .map(feedbackView);
    return { items, total, pending };
  });

  // 回复（已回复的可改回复）
  app.post('/admin/feedback/:id/reply', { schema: { params: idParams, body: replyBody } }, async (request) => {
    const text = request.body.reply.trim();
    if (!text) throw new HttpError(400, 'BAD_REQUEST', '请填写回复内容');
    const id = request.params.id;
    const t = now();
    const row = db.transaction(() => {
      const r = db
        .prepare("UPDATE feedback SET reply = ?, status = 'replied', replied_by = ?, replied_at = ? WHERE id = ? RETURNING *")
        .get(text, request.account.id, t, id);
      if (!r) throw new HttpError(404, 'FEEDBACK_NOT_FOUND', '留言不存在');
      audit(request, 'feedback.reply', 'feedback', id, { merchantId: r.merchant_id, length: text.length });
      return r;
    })();
    return { item: feedbackView(row) };
  });

  // ---------- 站点信息 ----------

  app.get('/admin/site-extras', async () => getSiteExtras(db));

  app.put('/admin/site-extras', { schema: { body: extrasBody } }, async (request) => {
    const patch = { ...request.body };
    for (const k of Object.keys(patch)) patch[k] = patch[k].trim();
    db.transaction(() => {
      const changed = updateSiteExtras(db, patch, now());
      audit(request, 'site.update', 'setting', '', { changed });
    })();
    return getSiteExtras(db);
  });

  // 上传二维码：?kind=wechat（联系我们）或 tip（打赏码），存 media/site/，旧图删除
  app.post('/admin/site-extras/qr', { schema: { querystring: qrQuery } }, async (request) => {
    const field = QR_FIELD[request.query.kind];
    const file = await readImage(request);
    if (!file?.length) throw new HttpError(400, 'BAD_REQUEST', '请选择二维码图片');
    const image = detectImage(file);
    if (!image) throw new HttpError(400, 'UNSUPPORTED_MEDIA', '只支持 JPG、PNG、WebP 图片');
    const old = getSiteExtras(db)[field];
    const key = await storage.put('site', file, image.ext);
    const url = `media/${key}`;
    try {
      db.transaction(() => {
        updateSiteExtras(db, { [field]: url }, now());
        audit(request, 'site.update', 'setting', '', { changed: [field] });
      })();
    } catch (error) {
      await storage.remove(key);
      throw error;
    }
    if (old.startsWith('media/site/')) await storage.remove(old.slice('media/'.length)).catch(() => {});
    return getSiteExtras(db);
  });
}
