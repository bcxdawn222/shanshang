// 联系我们 / 打赏码（SET-06、SET-08、ADM-08）：总后台配置，商家只读
const KEY_MAP = {
  contactPhone: 'site_contact_phone',
  contactAddress: 'site_contact_address',
  wechatQrUrl: 'site_wechat_qr_url',
  tipQrUrl: 'site_tip_qr_url',
};

export function getSiteExtras(db) {
  const stmt = db.prepare('SELECT value FROM setting WHERE key = ?').pluck();
  return Object.fromEntries(Object.entries(KEY_MAP).map(([field, key]) => [field, stmt.get(key) ?? '']));
}

/** 只更新传入的字段，返回实际改动的字段名 */
export function updateSiteExtras(db, patch, now) {
  const changed = [];
  const stmt = db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  db.transaction(() => {
    for (const [field, key] of Object.entries(KEY_MAP)) {
      if (patch[field] === undefined) continue;
      stmt.run(key, String(patch[field]), now);
      changed.push(field);
    }
  })();
  return changed;
}
