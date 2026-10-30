import { writeAudit } from '../lib/audit.js';
import { garmentView, loadDicts, promoteDue, retryXmaxUpload, slotUsage } from '../lib/garments.js';
import { requireAccount } from '../lib/guards.js';
import { HttpError, isUniqueViolation } from '../lib/http.js';

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

const noteBody = (required) => ({
  type: 'object',
  additionalProperties: false,
  ...(required ? { required: ['note'] } : {}),
  properties: { note: { type: 'string', minLength: required ? 1 : 0, maxLength: 200 } },
});

const SLOT_STEP = 5;

// 管理员：服饰审核、加格、标签字典（GAR-03、GAR-05、GAR-07、ADM-02、ADM-03）
export default async function adminGarmentRoutes(app, { ctx }) {
  const { db, now } = ctx;
  app.addHook('preValidation', requireAccount('admin'));

  const audit = (request, action, targetType, targetId, detail) =>
    writeAudit(db, { actorId: request.account.id, action, targetType, targetId, detail, ip: request.ip, now: now() });

  // ---------- 服饰审核 ----------

  app.get(
    '/admin/garments',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: ['reviewing', 'ready', 'rejected', 'offline'] },
            merchantId: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) => {
      promoteDue(db, now());
      const { status = null, merchantId = null } = request.query;
      const dicts = loadDicts(db);
      const rows = db
        .prepare(
          `SELECT g.*, m.brand_name FROM garment g JOIN merchant m ON m.account_id = g.merchant_id
            WHERE g.deleted_at IS NULL AND (? IS NULL OR g.status = ?) AND (? IS NULL OR g.merchant_id = ?)
            ORDER BY g.created_at DESC, g.id DESC LIMIT 500`,
        )
        .all(status, status, merchantId, merchantId);
      return { items: rows.map((g) => ({ ...garmentView(g, dicts), brandName: g.brand_name })) };
    },
  );

  function loadGarment(id) {
    const g = db.prepare('SELECT * FROM garment WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!g) throw new HttpError(404, 'GARMENT_NOT_FOUND', '服饰不存在');
    return g;
  }
  const view = (id) => garmentView(loadGarment(id), loadDicts(db));

  // 提前通过：立即上架。也用于恢复被驳回、被平台下架的服饰
  app.post('/admin/garments/:id/approve', { schema: { params: idParams, body: noteBody(false) } }, async (request) => {
    const g = loadGarment(request.params.id);
    const allowed = g.status === 'reviewing' || g.status === 'rejected' || (g.status === 'offline' && g.offline_by === 'admin');
    if (!allowed) throw new HttpError(409, 'INVALID_STATUS', '当前状态不能通过');
    const t = now();
    const note = (request.body?.note ?? '').trim();
    db.transaction(() => {
      db.prepare(
        `UPDATE garment SET status = 'ready', available_at = MIN(available_at, ?), offline_by = NULL,
                review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
      ).run(t, note, t, t, g.id);
      audit(request, 'garment.approve', 'garment', g.id, { from: g.status });
    })();
    await retryXmaxUpload(ctx, g, request.log);
    return { garment: view(g.id) };
  });

  app.post('/admin/garments/:id/reject', { schema: { params: idParams, body: noteBody(true) } }, async (request) => {
    const g = loadGarment(request.params.id);
    if (!['reviewing', 'ready'].includes(g.status)) throw new HttpError(409, 'INVALID_STATUS', '当前状态不能驳回');
    const note = request.body.note.trim();
    if (!note) throw new HttpError(400, 'BAD_REQUEST', '请填写驳回原因');
    const t = now();
    db.transaction(() => {
      db.prepare(
        "UPDATE garment SET status = 'rejected', offline_by = NULL, review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ?",
      ).run(note, t, t, g.id);
      audit(request, 'garment.reject', 'garment', g.id, { from: g.status, note });
    })();
    return { garment: view(g.id) };
  });

  app.post('/admin/garments/:id/offline', { schema: { params: idParams } }, async (request) => {
    const g = loadGarment(request.params.id);
    if (!['reviewing', 'ready'].includes(g.status)) throw new HttpError(409, 'INVALID_STATUS', '当前状态不能下架');
    db.transaction(() => {
      db.prepare("UPDATE garment SET status = 'offline', offline_by = 'admin', updated_at = ? WHERE id = ?").run(now(), g.id);
      audit(request, 'garment.offline', 'garment', g.id, { from: g.status });
    })();
    return { garment: view(g.id) };
  });

  // ---------- 加格（GAR-03：每次 +5） ----------

  app.post('/admin/merchants/:id/add-slots', { schema: { params: idParams } }, async (request) => {
    const id = request.params.id;
    const quota = db
      .prepare("SELECT m.slot_quota FROM merchant m JOIN account a ON a.id = m.account_id WHERE a.id = ? AND a.role = 'merchant'")
      .pluck()
      .get(id);
    if (quota === undefined) throw new HttpError(404, 'MERCHANT_NOT_FOUND', '商家不存在');
    db.transaction(() => {
      db.prepare('UPDATE merchant SET slot_quota = slot_quota + ? WHERE account_id = ?').run(SLOT_STEP, id);
      audit(request, 'merchant.add_slots', 'merchant', id, { from: quota, to: quota + SLOT_STEP });
    })();
    return { slots: slotUsage(db, id) };
  });

  // ---------- 标签字典 ----------

  app.get('/admin/dicts', async () => ({
    items: [...loadDicts(db).values()].map((d) => ({ id: d.id, kind: d.kind, name: d.name, enabled: Boolean(d.enabled), sort: d.sort })),
  }));

  app.post(
    '/admin/dicts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['kind', 'name'],
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['category', 'scene', 'color'] },
            name: { type: 'string', minLength: 1, maxLength: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const { kind } = request.body;
      const name = request.body.name.trim();
      if (!name) throw new HttpError(400, 'BAD_REQUEST', '名称不能为空');
      const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 FROM dict_item WHERE kind = ?').pluck().get(kind);
      let id;
      try {
        id = db.transaction(() => {
          const r = db.prepare('INSERT INTO dict_item (kind, name, sort) VALUES (?, ?, ?)').run(kind, name, sort);
          audit(request, 'dict.create', 'dict', r.lastInsertRowid, { kind, name });
          return Number(r.lastInsertRowid);
        })();
      } catch (error) {
        if (isUniqueViolation(error)) throw new HttpError(409, 'DICT_EXISTS', '已有同名标签');
        throw error;
      }
      reply.code(201);
      return { item: { id, kind, name, enabled: true, sort } };
    },
  );

  app.patch(
    '/admin/dicts/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 20 },
            enabled: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const item = db.prepare('SELECT * FROM dict_item WHERE id = ?').get(request.params.id);
      if (!item) throw new HttpError(404, 'DICT_NOT_FOUND', '标签不存在');
      const name = request.body.name?.trim() ?? item.name;
      if (!name) throw new HttpError(400, 'BAD_REQUEST', '名称不能为空');
      const enabled = request.body.enabled ?? Boolean(item.enabled);
      try {
        db.transaction(() => {
          db.prepare('UPDATE dict_item SET name = ?, enabled = ? WHERE id = ?').run(name, enabled ? 1 : 0, item.id);
          audit(request, 'dict.update', 'dict', item.id, { name, enabled });
        })();
      } catch (error) {
        if (isUniqueViolation(error)) throw new HttpError(409, 'DICT_EXISTS', '已有同名标签');
        throw error;
      }
      return { item: { id: item.id, kind: item.kind, name, enabled, sort: item.sort } };
    },
  );
}
