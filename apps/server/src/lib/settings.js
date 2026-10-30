// 平台设置：只有管理员能改（ACC-05），商家和设备只读
const KEY_MAP = {
  platformName: 'platform_name',
  logoUrl: 'logo_url',
  loginBgUrl: 'login_bg_url',
};

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM setting').all();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(Object.entries(KEY_MAP).map(([field, key]) => [field, byKey[key] ?? '']));
}

/** 只更新传入的字段，返回实际改动的字段名 */
export function updateSettings(db, patch, now) {
  const changed = [];
  const stmt = db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  db.transaction(() => {
    for (const [field, key] of Object.entries(KEY_MAP)) {
      if (patch[field] === undefined) continue;
      stmt.run(key, patch[field], now);
      changed.push(field);
    }
  })();
  return changed;
}
