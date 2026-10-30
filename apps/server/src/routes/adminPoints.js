import { writeAudit } from '../lib/audit.js';
import { requireAccount } from '../lib/guards.js';
import { HttpError } from '../lib/http.js';
import { detectImage } from '../lib/images.js';
import {
  LEDGER_TYPES,
  appendEntry,
  getPointsConfig,
  isHidden,
  queryLedger,
  toMilli,
  toPoints,
  updatePointsConfig,
} from '../lib/points.js';

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

const adjustBody = {
  type: 'object',
  required: ['type', 'amount', 'note'],
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['add', 'deduct'] },
    amount: { type: 'number', minimum: 0.01, maximum: 1_000_000 },
    note: { type: 'string', minLength: 1, maxLength: 200 },
  },
};

const ledgerQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    merchantId: { type: 'integer', minimum: 1 },
    type: { type: 'string', enum: LEDGER_TYPES },
    page: { type: 'integer', minimum: 1, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
};

const configBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    pointsPerMinute: { type: 'number', minimum: 0.01, maximum: 100 },
    hideThreshold: { type: 'number', minimum: 0, maximum: 100_000 },
    xmaxRatio: { type: 'string', maxLength: 20 },
    rechargeContact: { type: 'string', maxLength: 200 },
    // 空串、站内媒体路径或 http(s) 地址
    rechargeQrUrl: { type: 'string', maxLength: 500, pattern: '^(|media/[A-Za-z0-9/._-]+|https?://\\S+)$' },
    tryonMaxMinutes: { type: 'integer', minimum: 1, maximum: 30 },
  },
};

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

// 总后台积分：商家余额、手动加扣、流水、积分配置、收款码（PT-01~06、SET-02~03）
export default async function adminPointsRoutes(app, { ctx }) {
  const { db, now, storage } = ctx;
  app.addHook('preValidation', requireAccount('admin'));

  const audit = (request, action, targetType, targetId, detail) =>
    writeAudit(db, { actorId: request.account.id, action, targetType, targetId, detail, ip: request.ip, now: now() });

  app.get('/admin/points/merchants', async () => {
    const config = getPointsConfig(db);
    const rows = db
      .prepare(
        `SELECT a.id, a.username, a.status, m.brand_name, m.balance_milli,
                (SELECT COALESCE(SUM(duration_ms), 0) FROM point_ledger l
                  WHERE l.merchant_id = a.id AND l.type = 'TRYON_CONSUME') AS usage_ms
           FROM account a JOIN merchant m ON m.account_id = a.id
          WHERE a.role = 'merchant'
          ORDER BY a.created_at DESC, a.id DESC LIMIT 500`,
      )
      .all();
    return {
      items: rows.map((r) => ({
        merchantId: r.id,
        username: r.username,
        brandName: r.brand_name,
        status: r.status,
        balance: toPoints(r.balance_milli),
        balanceMilli: r.balance_milli,
        usageMs: r.usage_ms,
        hidden: isHidden(r.balance_milli, config),
      })),
    };
  });

  // 手动加 / 扣积分，备注必填；扣到负数也允许（与试穿透支口径一致）
  app.post('/admin/merchants/:id/points', { schema: { params: idParams, body: adjustBody } }, async (request) => {
    const id = request.params.id;
    const exists = db
      .prepare("SELECT 1 FROM account a JOIN merchant m ON m.account_id = a.id WHERE a.id = ? AND a.role = 'merchant'")
      .get(id);
    if (!exists) throw new HttpError(404, 'MERCHANT_NOT_FOUND', '商家不存在');
    const note = request.body.note.trim();
    if (!note) throw new HttpError(400, 'BAD_REQUEST', '请填写备注');
    const milli = toMilli(request.body.amount);
    if (milli <= 0) throw new HttpError(400, 'BAD_REQUEST', '积分数量不正确');
    const add = request.body.type === 'add';
    const balanceMilli = db.transaction(() => {
      const balance = appendEntry(db, {
        merchantId: id,
        type: add ? 'ADMIN_ADD' : 'ADMIN_DEDUCT',
        amountMilli: add ? milli : -milli,
        note,
        actorId: request.account.id,
        now: now(),
      });
      audit(request, add ? 'points.add' : 'points.deduct', 'merchant', id, {
        amountMilli: milli,
        balanceAfterMilli: balance,
        note,
      });
      return balance;
    })();
    return { balance: toPoints(balanceMilli), balanceMilli };
  });

  app.get('/admin/points/ledger', { schema: { querystring: ledgerQuery } }, async (request) => {
    const { merchantId = null, type = null, page, pageSize } = request.query;
    return queryLedger(db, { merchantId, type, page, pageSize });
  });

  app.get('/admin/points/config', async () => getPointsConfig(db));

  app.put('/admin/points/config', { schema: { body: configBody } }, async (request) => {
    const patch = { ...request.body };
    for (const k of ['xmaxRatio', 'rechargeContact']) {
      if (patch[k] !== undefined) patch[k] = patch[k].trim();
    }
    const changed = db.transaction(() => {
      const fields = updatePointsConfig(db, patch, now());
      audit(request, 'points.config', 'setting', '', { changed: fields });
      return fields;
    })();
    request.log.info({ changed }, 'points config updated');
    return getPointsConfig(db);
  });

  // 上传充值收款码：按文件头识别类型，存到 media/recharge/，旧图删除
  app.post('/admin/points/recharge-qr', async (request) => {
    const file = await readImage(request);
    if (!file?.length) throw new HttpError(400, 'BAD_REQUEST', '请选择收款码图片');
    const image = detectImage(file);
    if (!image) throw new HttpError(400, 'UNSUPPORTED_MEDIA', '只支持 JPG、PNG、WebP 图片');
    const old = getPointsConfig(db).rechargeQrUrl;
    const key = await storage.put('recharge', file, image.ext);
    const url = `media/${key}`;
    try {
      db.transaction(() => {
        updatePointsConfig(db, { rechargeQrUrl: url }, now());
        audit(request, 'points.config', 'setting', '', { changed: ['rechargeQrUrl'] });
      })();
    } catch (error) {
      await storage.remove(key);
      throw error;
    }
    if (old.startsWith('media/recharge/')) await storage.remove(old.slice('media/'.length)).catch(() => {});
    return getPointsConfig(db);
  });
}
