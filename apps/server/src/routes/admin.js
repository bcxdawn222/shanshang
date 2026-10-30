import { getAccountView } from '../lib/accounts.js';
import { writeAudit } from '../lib/audit.js';
import { requireAccount } from '../lib/guards.js';
import { HttpError } from '../lib/http.js';
import { hashPassword } from '../lib/password.js';
import { revokeAllSessions } from '../lib/session.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { randomPassword } from '../lib/tokens.js';

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

const bindBody = {
  type: 'object',
  required: ['code', 'name'],
  additionalProperties: false,
  properties: {
    code: { type: 'string', pattern: '^[A-Za-z0-9]{8}$' },
    name: { type: 'string', minLength: 1, maxLength: 40 },
    location: { type: 'string', maxLength: 60 },
  },
};

const deviceUpdateBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 40 },
    location: { type: 'string', maxLength: 60 },
  },
};

// 空串、http(s) 地址或站内路径
const urlField = { type: 'string', maxLength: 500, pattern: '^(|https?://\\S+|/\\S*)$' };
const settingsBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    platformName: { type: 'string', minLength: 1, maxLength: 20 },
    logoUrl: urlField,
    loginBgUrl: urlField,
  },
};

function deviceView(d) {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    location: d.location,
    status: d.status,
    createdAt: d.created_at,
    boundAt: d.bound_at,
    lastSeenAt: d.last_seen_at,
  };
}

export default async function adminRoutes(app, { ctx }) {
  const { db, now } = ctx;
  // 先鉴权再校验参数：未登录请求一律 401，不暴露接口参数格式
  app.addHook('preValidation', requireAccount('admin'));

  const audit = (request, action, targetType, targetId, detail) =>
    writeAudit(db, { actorId: request.account.id, action, targetType, targetId, detail, ip: request.ip, now: now() });

  // ---------- 商家（ACC-03、ACC-07） ----------

  app.get(
    '/admin/merchants',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'disabled'] } },
        },
      },
    },
    async (request) => {
      const status = request.query.status ?? null;
      const ids = db
        .prepare(
          `SELECT id FROM account
            WHERE role = 'merchant' AND (? IS NULL OR status = ?)
            ORDER BY created_at DESC, id DESC LIMIT 500`,
        )
        .pluck()
        .all(status, status);
      return { items: ids.map((id) => getAccountView(db, id)) };
    },
  );

  function loadMerchant(id) {
    const row = db
      .prepare(
        `SELECT a.id, a.status, m.status_before_disable FROM account a JOIN merchant m ON m.account_id = a.id
          WHERE a.id = ? AND a.role = 'merchant'`,
      )
      .get(id);
    if (!row) throw new HttpError(404, 'MERCHANT_NOT_FOUND', '商家不存在');
    return row;
  }

  /** 状态流转：from 列出允许的当前状态 */
  function transition(request, { from, to, action, note }) {
    const id = request.params.id;
    const merchant = loadMerchant(id);
    if (!from.includes(merchant.status)) {
      throw new HttpError(409, 'INVALID_STATUS', `当前状态（${merchant.status}）不能执行此操作`);
    }
    const target = typeof to === 'function' ? to(merchant) : to;
    const t = now();
    db.transaction(() => {
      db.prepare('UPDATE account SET status = ?, updated_at = ? WHERE id = ?').run(target, t, id);
      if (note !== undefined) {
        db.prepare('UPDATE merchant SET review_note = ?, reviewed_at = ? WHERE account_id = ?').run(note, t, id);
      }
      if (target === 'disabled') {
        db.prepare('UPDATE merchant SET status_before_disable = ? WHERE account_id = ?').run(merchant.status, id);
        revokeAllSessions(db, id);
      }
      audit(request, action, 'merchant', id, { from: merchant.status, to: target, ...(note ? { note } : {}) });
    })();
    return { account: getAccountView(db, id) };
  }

  // 审核通过：默认 18 格由表默认值保证
  app.post('/admin/merchants/:id/approve', { schema: { params: idParams, body: noteBody(false) } }, async (request) =>
    transition(request, {
      from: ['pending', 'rejected'],
      to: 'approved',
      action: 'merchant.approve',
      note: (request.body?.note ?? '').trim(),
    }),
  );

  app.post('/admin/merchants/:id/reject', { schema: { params: idParams, body: noteBody(true) } }, async (request) => {
    const note = request.body.note.trim();
    if (!note) throw new HttpError(400, 'BAD_REQUEST', '请填写驳回原因');
    return transition(request, { from: ['pending'], to: 'rejected', action: 'merchant.reject', note });
  });

  app.post('/admin/merchants/:id/disable', { schema: { params: idParams } }, async (request) =>
    transition(request, { from: ['pending', 'approved', 'rejected'], to: 'disabled', action: 'merchant.disable' }),
  );

  // 启用：恢复停用前的状态（待审核 / 已通过 / 已驳回），避免借启用跳过审核
  app.post('/admin/merchants/:id/enable', { schema: { params: idParams } }, async (request) =>
    transition(request, {
      from: ['disabled'],
      to: (m) => m.status_before_disable || 'pending',
      action: 'merchant.enable',
    }),
  );

  // 重置密码：临时密码只在本次响应里返回一次，不写日志
  app.post('/admin/merchants/:id/reset-password', { schema: { params: idParams } }, async (request) => {
    const id = request.params.id;
    loadMerchant(id);
    const temporaryPassword = randomPassword(12);
    const hash = await hashPassword(temporaryPassword);
    db.transaction(() => {
      db.prepare('UPDATE account SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, now(), id);
      revokeAllSessions(db, id);
      audit(request, 'merchant.reset_password', 'merchant', id);
    })();
    return { temporaryPassword };
  });

  // ---------- 设备（DVC-01、DVC-02、ADM-05） ----------

  app.get('/admin/devices', async () => ({
    items: db
      .prepare(
        `SELECT * FROM device
          ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'bound' THEN 1 ELSE 2 END, created_at DESC
          LIMIT 500`,
      )
      .all()
      .map(deviceView),
  }));

  app.post('/admin/devices/bind', { schema: { body: bindBody } }, async (request) => {
    const code = request.body.code.toUpperCase();
    const device = db.prepare('SELECT * FROM device WHERE code = ?').get(code);
    if (!device) throw new HttpError(404, 'DEVICE_NOT_FOUND', '设备码不存在，请核对屏幕上显示的设备码');
    if (device.status !== 'pending') throw new HttpError(409, 'DEVICE_ALREADY_BOUND', '该设备已绑定或已停用');
    const t = now();
    const name = request.body.name.trim();
    const location = (request.body.location ?? '').trim();
    db.transaction(() => {
      db.prepare("UPDATE device SET status = 'bound', name = ?, location = ?, bound_at = ? WHERE id = ?").run(
        name,
        location,
        t,
        device.id,
      );
      audit(request, 'device.bind', 'device', device.id, { code, name, location });
    })();
    return { device: deviceView(db.prepare('SELECT * FROM device WHERE id = ?').get(device.id)) };
  });

  function loadDevice(id) {
    const device = db.prepare('SELECT * FROM device WHERE id = ?').get(id);
    if (!device) throw new HttpError(404, 'DEVICE_NOT_FOUND', '设备不存在');
    return device;
  }

  app.patch('/admin/devices/:id', { schema: { params: idParams, body: deviceUpdateBody } }, async (request) => {
    const device = loadDevice(request.params.id);
    const name = request.body.name?.trim() ?? device.name;
    const location = request.body.location?.trim() ?? device.location;
    db.transaction(() => {
      db.prepare('UPDATE device SET name = ?, location = ? WHERE id = ?').run(name, location, device.id);
      audit(request, 'device.update', 'device', device.id, { name, location });
    })();
    return { device: deviceView(loadDevice(device.id)) };
  });

  app.post('/admin/devices/:id/disable', { schema: { params: idParams } }, async (request) => {
    const device = loadDevice(request.params.id);
    if (device.status === 'disabled') throw new HttpError(409, 'INVALID_STATUS', '设备已停用');
    db.transaction(() => {
      db.prepare("UPDATE device SET status = 'disabled' WHERE id = ?").run(device.id);
      audit(request, 'device.disable', 'device', device.id, { from: device.status });
    })();
    return { device: deviceView(loadDevice(device.id)) };
  });

  app.post('/admin/devices/:id/enable', { schema: { params: idParams } }, async (request) => {
    const device = loadDevice(request.params.id);
    if (device.status !== 'disabled') throw new HttpError(409, 'INVALID_STATUS', '设备未停用');
    const target = device.bound_at ? 'bound' : 'pending';
    db.transaction(() => {
      db.prepare('UPDATE device SET status = ? WHERE id = ?').run(target, device.id);
      audit(request, 'device.enable', 'device', device.id, { to: target });
    })();
    return { device: deviceView(loadDevice(device.id)) };
  });

  // ---------- 平台设置（ACC-04、ACC-05） ----------

  app.get('/admin/settings', async () => getSettings(db));

  app.put('/admin/settings', { schema: { body: settingsBody } }, async (request) => {
    const patch = { ...request.body };
    if (patch.platformName !== undefined) {
      patch.platformName = patch.platformName.trim();
      if (!patch.platformName) throw new HttpError(400, 'BAD_REQUEST', '平台名称不能为空');
    }
    const changed = updateSettings(db, patch, now());
    audit(request, 'settings.update', 'setting', '', { changed });
    return getSettings(db);
  });

  // ---------- 审计日志（ACC-08） ----------

  app.get(
    '/admin/audit-logs',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            beforeId: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) => {
      const { limit, beforeId = null } = request.query;
      const items = db
        .prepare(
          `SELECT l.id, l.actor_id, a.username AS actor, l.action, l.target_type, l.target_id, l.detail, l.ip, l.created_at
             FROM audit_log l LEFT JOIN account a ON a.id = l.actor_id
            WHERE (? IS NULL OR l.id < ?)
            ORDER BY l.id DESC LIMIT ?`,
        )
        .all(beforeId, beforeId, limit)
        .map((r) => ({
          id: r.id,
          actorId: r.actor_id,
          actor: r.actor,
          action: r.action,
          targetType: r.target_type,
          targetId: r.target_id,
          detail: r.detail ? JSON.parse(r.detail) : null,
          ip: r.ip,
          createdAt: r.created_at,
        }));
      return { items };
    },
  );
}
