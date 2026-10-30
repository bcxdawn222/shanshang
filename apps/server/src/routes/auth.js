import { getAccountView } from '../lib/accounts.js';
import { writeAudit } from '../lib/audit.js';
import { HttpError, isUniqueViolation } from '../lib/http.js';
import { dummyVerify, hashPassword, verifyPassword } from '../lib/password.js';
import { SESSION_COOKIE, createSession, revokeAllSessions, revokeSession } from '../lib/session.js';

const loginBody = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64 },
    password: { type: 'string', minLength: 1, maxLength: 128 },
  },
};

const registerBody = {
  type: 'object',
  required: ['username', 'password', 'brandName'],
  additionalProperties: false,
  properties: {
    username: { type: 'string', pattern: '^[A-Za-z0-9_]{3,32}$' },
    password: { type: 'string', minLength: 8, maxLength: 64 },
    brandName: { type: 'string', minLength: 1, maxLength: 40 },
    contact: { type: 'string', maxLength: 60 },
  },
};

const passwordBody = {
  type: 'object',
  required: ['oldPassword', 'newPassword'],
  additionalProperties: false,
  properties: {
    oldPassword: { type: 'string', minLength: 1, maxLength: 128 },
    newPassword: { type: 'string', minLength: 8, maxLength: 64 },
  },
};

export default async function authRoutes(app, { ctx }) {
  const { db, config, now, limiters } = ctx;

  function setSessionCookie(reply, token) {
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: Math.floor(config.sessionTtlMs / 1000),
    });
  }

  async function login(request, reply, role) {
    const { username, password } = request.body;
    const key = `${request.ip}|${role}|${username.toLowerCase()}`;
    const left = limiters.login.lockedFor(key);
    if (left > 0) {
      throw new HttpError(429, 'LOGIN_LOCKED', `登录失败次数过多，请 ${Math.ceil(left / 60_000)} 分钟后再试`);
    }

    const row = db.prepare('SELECT id, password_hash, status FROM account WHERE username = ? AND role = ?').get(username, role);
    const ok = row ? await verifyPassword(password, row.password_hash) : await dummyVerify(password);
    if (!ok) {
      limiters.login.fail(key);
      throw new HttpError(401, 'BAD_CREDENTIALS', role === 'admin' ? '账号或口令错误' : '用户名或密码错误');
    }
    limiters.login.reset(key);
    if (row.status === 'disabled') throw new HttpError(403, 'ACCOUNT_DISABLED', '账号已停用，请联系管理员');

    setSessionCookie(reply, createSession(db, row.id, { ttlMs: config.sessionTtlMs, now }));
    if (role === 'admin') writeAudit(db, { actorId: row.id, action: 'admin.login', ip: request.ip, now: now() });
    return { account: getAccountView(db, row.id) };
  }

  app.post('/auth/admin/login', { schema: { body: loginBody } }, (request, reply) => login(request, reply, 'admin'));
  app.post('/auth/merchant/login', { schema: { body: loginBody } }, (request, reply) => login(request, reply, 'merchant'));

  // 商家自助注册，注册后为“待审核”（ACC-02）
  app.post('/auth/merchant/register', { schema: { body: registerBody } }, async (request, reply) => {
    if (!limiters.register.hit(request.ip)) throw new HttpError(429, 'TOO_MANY_REQUESTS', '注册过于频繁，请稍后再试');
    const { username, password, contact = '' } = request.body;
    const brandName = request.body.brandName.trim();
    if (!brandName) throw new HttpError(400, 'BAD_REQUEST', '品牌名称不能为空');
    if (db.prepare('SELECT 1 FROM account WHERE username = ?').get(username)) {
      throw new HttpError(409, 'USERNAME_TAKEN', '用户名已被占用');
    }

    const hash = await hashPassword(password);
    const t = now();
    let id;
    try {
      id = db.transaction(() => {
        const r = db
          .prepare(
            `INSERT INTO account (role, username, password_hash, nickname, status, created_at, updated_at)
             VALUES ('merchant', ?, ?, ?, 'pending', ?, ?)`,
          )
          .run(username, hash, brandName, t, t);
        db.prepare('INSERT INTO merchant (account_id, brand_name, contact) VALUES (?, ?, ?)').run(
          r.lastInsertRowid,
          brandName,
          contact.trim(),
        );
        return Number(r.lastInsertRowid);
      })();
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'USERNAME_TAKEN', '用户名已被占用');
      throw error;
    }

    setSessionCookie(reply, createSession(db, id, { ttlMs: config.sessionTtlMs, now }));
    reply.code(201);
    return { account: getAccountView(db, id) };
  });

  app.post('/auth/logout', async (request, reply) => {
    revokeSession(db, request.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (request) => {
    if (!request.account) throw new HttpError(401, 'UNAUTHENTICATED', '请先登录');
    return { account: getAccountView(db, request.account.id) };
  });

  // 改密后所有旧会话失效，当前设备重新签发一个会话（SET-01）
  app.post('/auth/password', { schema: { body: passwordBody } }, async (request, reply) => {
    const account = request.account;
    if (!account) throw new HttpError(401, 'UNAUTHENTICATED', '请先登录');
    const row = db.prepare('SELECT password_hash FROM account WHERE id = ?').get(account.id);
    if (!(await verifyPassword(request.body.oldPassword, row.password_hash))) {
      throw new HttpError(400, 'BAD_OLD_PASSWORD', '原密码不正确');
    }
    const hash = await hashPassword(request.body.newPassword);
    const t = now();
    db.transaction(() => {
      db.prepare('UPDATE account SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, t, account.id);
      revokeAllSessions(db, account.id);
      writeAudit(db, { actorId: account.id, action: 'account.password_change', targetType: 'account', targetId: account.id, ip: request.ip, now: t });
    })();
    setSessionCookie(reply, createSession(db, account.id, { ttlMs: config.sessionTtlMs, now }));
    return { ok: true };
  });
}
