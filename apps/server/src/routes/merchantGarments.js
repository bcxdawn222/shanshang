import { randomInt } from 'node:crypto';
import { writeAudit } from '../lib/audit.js';
import {
  REVIEW_DELAY_MAX_MS,
  REVIEW_DELAY_MIN_MS,
  garmentView,
  loadDicts,
  parseGarmentFields,
  promoteDue,
  slotFullError,
  slotUsage,
  tryXmaxUpload,
} from '../lib/garments.js';
import { requireAccount } from '../lib/guards.js';
import { HttpError } from '../lib/http.js';
import { detectImage } from '../lib/images.js';

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

/** 读取 multipart：字段 + 一张名为 image 的图片 */
async function readUpload(request) {
  if (!request.isMultipart()) throw new HttpError(400, 'BAD_REQUEST', '请用表单上传');
  const fields = {};
  let file = null;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const buf = await part.toBuffer();
      if (part.fieldname === 'image' && !file) file = buf;
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }
  return { fields, file };
}

// 商家服饰：只能操作自己的，merchant_id 一律取登录态（GAR-01~08）
export default async function merchantGarmentRoutes(app, { ctx }) {
  const { db, now, storage } = ctx;
  app.addHook('preValidation', requireAccount('merchant', { approved: true }));

  const audit = (request, action, targetId, detail) =>
    writeAudit(db, { actorId: request.account.id, action, targetType: 'garment', targetId, detail, ip: request.ip, now: now() });

  function own(request) {
    const g = db
      .prepare('SELECT * FROM garment WHERE id = ? AND merchant_id = ? AND deleted_at IS NULL')
      .get(request.params.id, request.account.id);
    if (!g) throw new HttpError(404, 'GARMENT_NOT_FOUND', '服饰不存在');
    return g;
  }

  const view = (id) => garmentView(db.prepare('SELECT * FROM garment WHERE id = ?').get(id), loadDicts(db));

  app.get('/merchant/garments', async (request) => {
    promoteDue(db, now());
    const dicts = loadDicts(db);
    const rows = db
      .prepare('SELECT * FROM garment WHERE merchant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC')
      .all(request.account.id);
    return { items: rows.map((g) => garmentView(g, dicts)), slots: slotUsage(db, request.account.id) };
  });

  app.post('/merchant/garments', async (request, reply) => {
    const merchantId = request.account.id;
    const before = slotUsage(db, merchantId);
    if (before.used >= before.quota) throw slotFullError();

    const { fields, file } = await readUpload(request);
    if (!file?.length) throw new HttpError(400, 'BAD_REQUEST', '请选择服饰图片');
    const image = detectImage(file);
    if (!image) throw new HttpError(400, 'UNSUPPORTED_MEDIA', '只支持 JPG、PNG、WebP 图片');
    const input = parseGarmentFields(loadDicts(db), fields);

    const imageKey = await storage.put('garments', file, image.ext);
    const xmaxUrl = await tryXmaxUpload(ctx, file, image.mime, request.log);
    const t = now();
    const availableAt = t + randomInt(REVIEW_DELAY_MIN_MS, REVIEW_DELAY_MAX_MS + 1);

    let id;
    try {
      id = db.transaction(() => {
        // 并发上传时再查一次格位
        const s = slotUsage(db, merchantId);
        if (s.used >= s.quota) throw slotFullError();
        const r = db
          .prepare(
            `INSERT INTO garment (merchant_id, title, gender, set_type, category_id, color_id, scene_ids, discount_text,
                                  shop_location, image_key, xmax_url, status, available_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reviewing', ?, ?, ?)`,
          )
          .run(
            merchantId,
            input.title,
            input.gender,
            input.setType,
            input.categoryId,
            input.colorId,
            JSON.stringify(input.sceneIds),
            input.discountText,
            input.shopLocation,
            imageKey,
            xmaxUrl,
            availableAt,
            t,
            t,
          );
        const newId = Number(r.lastInsertRowid);
        audit(request, 'garment.upload', newId, { title: input.title, xmax: Boolean(xmaxUrl) });
        return newId;
      })();
    } catch (error) {
      await storage.remove(imageKey);
      throw error;
    }

    reply.code(201);
    return { garment: view(id), slots: slotUsage(db, merchantId) };
  });

  app.post('/merchant/garments/:id/offline', { schema: { params: idParams } }, async (request) => {
    const g = own(request);
    if (!['reviewing', 'ready'].includes(g.status)) throw new HttpError(409, 'INVALID_STATUS', '当前状态不能下架');
    db.transaction(() => {
      db.prepare("UPDATE garment SET status = 'offline', offline_by = 'merchant', updated_at = ? WHERE id = ?").run(now(), g.id);
      audit(request, 'garment.offline', g.id, { from: g.status });
    })();
    return { garment: view(g.id) };
  });

  // 重新上架：审核期没到的回到审核期，到了直接上架；平台下架的不能自己恢复
  app.post('/merchant/garments/:id/online', { schema: { params: idParams } }, async (request) => {
    const g = own(request);
    if (g.status !== 'offline') throw new HttpError(409, 'INVALID_STATUS', '服饰未下架');
    if (g.offline_by === 'admin') throw new HttpError(403, 'GARMENT_LOCKED', '该服饰已被平台下架，请联系管理员');
    const t = now();
    const target = g.available_at <= t ? 'ready' : 'reviewing';
    db.transaction(() => {
      db.prepare('UPDATE garment SET status = ?, offline_by = NULL, updated_at = ? WHERE id = ?').run(target, t, g.id);
      audit(request, 'garment.online', g.id, { to: target });
    })();
    return { garment: view(g.id) };
  });

  // 删除释放格位（软删除，保留记录用于统计和审计；原图删除）
  app.delete('/merchant/garments/:id', { schema: { params: idParams } }, async (request) => {
    const g = own(request);
    db.transaction(() => {
      db.prepare('UPDATE garment SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), g.id);
      audit(request, 'garment.delete', g.id, { title: g.title });
    })();
    await storage.remove(g.image_key);
    return { ok: true, slots: slotUsage(db, request.account.id) };
  });
}
