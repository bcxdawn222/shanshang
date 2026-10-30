/** 后台关键操作审计（ACC-08）。detail 不要放密码、令牌等敏感值 */
export function writeAudit(db, { actorId = null, action, targetType = '', targetId = '', detail = null, ip = '', now }) {
  db.prepare(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(actorId, action, targetType, String(targetId ?? ''), detail ? JSON.stringify(detail) : null, ip, now);
}
