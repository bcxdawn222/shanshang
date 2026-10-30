import { hashPassword } from './password.js';

/** 对外展示的账号信息（不含密码哈希） */
export function getAccountView(db, id) {
  const a = db
    .prepare('SELECT id, role, username, nickname, status, created_at FROM account WHERE id = ?')
    .get(id);
  if (!a) return null;
  const view = {
    id: a.id,
    role: a.role,
    username: a.username,
    nickname: a.nickname,
    status: a.status,
    createdAt: a.created_at,
  };
  if (a.role === 'merchant') {
    const m = db
      .prepare(
        'SELECT brand_name, contact, shop_location, slot_quota, review_note, reviewed_at FROM merchant WHERE account_id = ?',
      )
      .get(id);
    view.merchant = {
      brandName: m.brand_name,
      contact: m.contact,
      shopLocation: m.shop_location,
      slotQuota: m.slot_quota,
      reviewNote: m.review_note,
      reviewedAt: m.reviewed_at,
    };
  }
  return view;
}

/** 首次启动按环境变量创建唯一超级管理员；已有管理员则不动（不会被环境变量覆盖） */
export async function ensureAdmin(db, config, now) {
  if (db.prepare("SELECT 1 FROM account WHERE role = 'admin'").get()) return false;
  if (!config.adminUsername || !config.adminPassword) return false;
  if (config.adminPassword.length < 12) throw new Error('ADMIN_PASSWORD 至少 12 位');
  const t = now();
  db.prepare(
    `INSERT INTO account (role, username, password_hash, nickname, status, created_at, updated_at)
     VALUES ('admin', ?, ?, '超级管理员', 'approved', ?, ?)`,
  ).run(config.adminUsername, await hashPassword(config.adminPassword), t, t);
  return true;
}

/** 创建一个已审核通过的商家（演示商家种子用） */
export async function createApprovedMerchant(db, { username, password, brandName, note = '', now }) {
  const hash = await hashPassword(password);
  const t = now();
  return db.transaction(() => {
    const r = db
      .prepare(
        `INSERT INTO account (role, username, password_hash, nickname, status, created_at, updated_at)
         VALUES ('merchant', ?, ?, ?, 'approved', ?, ?)`,
      )
      .run(username, hash, brandName, t, t);
    db.prepare(
      'INSERT INTO merchant (account_id, brand_name, review_note, reviewed_at) VALUES (?, ?, ?, ?)',
    ).run(r.lastInsertRowid, brandName, note, t);
    return Number(r.lastInsertRowid);
  })();
}
