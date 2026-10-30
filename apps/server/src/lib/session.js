import { randomToken, sha256 } from './tokens.js';

export const SESSION_COOKIE = 'sl_sid';

export function createSession(db, accountId, { ttlMs, now }) {
  const token = randomToken();
  const t = now();
  db.prepare('INSERT INTO session (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    accountId,
    t,
    t + ttlMs,
  );
  return token;
}

/** 按 Cookie 里的令牌找到会话和账号；过期即删除 */
export function loadSession(db, token, nowMs) {
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = db
    .prepare(
      `SELECT s.expires_at, a.id, a.role, a.username, a.nickname, a.status
         FROM session s JOIN account a ON a.id = s.account_id
        WHERE s.token_hash = ?`,
    )
    .get(tokenHash);
  if (!row) return null;
  if (row.expires_at <= nowMs) {
    db.prepare('DELETE FROM session WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return {
    account: { id: row.id, role: row.role, username: row.username, nickname: row.nickname, status: row.status },
  };
}

export function revokeSession(db, token) {
  if (token) db.prepare('DELETE FROM session WHERE token_hash = ?').run(sha256(token));
}

/** 改密、停用、重置密码时调用：该账号所有会话立即失效 */
export function revokeAllSessions(db, accountId) {
  db.prepare('DELETE FROM session WHERE account_id = ?').run(accountId);
}
