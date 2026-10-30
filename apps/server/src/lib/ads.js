import { deviceGarments } from './garments.js';
import { sha256 } from './tokens.js';

/**
 * Phase 4：待机播放列表、热门榜、短剧专题的查询（PLY-01~04、DEV-05~06、DEV-08、ADM-06）。
 * 写操作在 routes/adminAds.js，这里只放设备端与后台共用的读逻辑。
 */

export const HOT_WINDOW_MS = 7 * 24 * 3600_000;
export const HOT_TOP_N = 20;

export const assetUrl = (key) => `media/${key}`;

export function assetView(a) {
  return { id: a.id, type: a.type, name: a.name, url: assetUrl(a.storage_key), sizeBytes: a.size_bytes, createdAt: a.created_at };
}

/** 某个列表的条目；deviceId 为 null 是默认列表 */
export function playlistRows(db, deviceId) {
  return db
    .prepare(
      `SELECT p.asset_id, p.seconds, a.type, a.storage_key
         FROM playlist_item p JOIN ad_asset a ON a.id = p.asset_id
        WHERE p.device_id IS ? ORDER BY p.position, p.id`,
    )
    .all(deviceId);
}

/** 设备有自己的条目就用自己的，否则用默认列表。version = (assetId, seconds, url) 内容的 sha256 前 16 位 */
export function devicePlaylist(db, deviceId) {
  let rows = playlistRows(db, deviceId);
  if (!rows.length) rows = playlistRows(db, null);
  const items = rows.map((r) => ({ assetId: r.asset_id, type: r.type, url: assetUrl(r.storage_key), seconds: r.seconds }));
  const version = sha256(JSON.stringify(items.map((i) => [i.assetId, i.seconds, i.url]))).slice(0, 16);
  return { version, items };
}

/**
 * 热门榜排序：未移出的置顶项按置顶先后在最前，其余按近 7 天 TRYON_CONSUME 条数降序、id 升序；
 * 返回 { garmentId, tryonCount, pinned, removed }，含被移出和 0 次的干预项，由调用方过滤。
 */
export function hotRanking(db, nowMs) {
  const counts = new Map(
    db
      .prepare(
        `SELECT garment_id, COUNT(*) AS n FROM point_ledger
          WHERE type = 'TRYON_CONSUME' AND created_at >= ? AND garment_id IS NOT NULL
          GROUP BY garment_id`,
      )
      .all(nowMs - HOT_WINDOW_MS)
      .map((r) => [r.garment_id, r.n]),
  );
  const overrides = new Map(db.prepare('SELECT * FROM hot_override').all().map((o) => [o.garment_id, o]));
  const ids = new Set([...counts.keys(), ...overrides.keys()]);
  const rows = [...ids].map((id) => {
    const o = overrides.get(id);
    const removed = Boolean(o?.removed);
    return { garmentId: id, tryonCount: counts.get(id) ?? 0, pinOrder: removed ? null : (o?.pin_order ?? null), removed };
  });
  rows.sort((a, b) => {
    if (a.removed !== b.removed) return a.removed ? 1 : -1;
    const ap = a.pinOrder != null;
    const bp = b.pinOrder != null;
    if (ap !== bp) return ap ? -1 : 1;
    if (ap) return a.pinOrder - b.pinOrder;
    return b.tryonCount - a.tryonCount || a.garmentId - b.garmentId;
  });
  return rows.map(({ pinOrder, ...r }) => ({ ...r, pinned: pinOrder != null }));
}

/** 设备热门榜：只含设备可见服饰；未置顶且 7 天内 0 次的不进榜；最多 20 条 */
export function deviceHot(db, nowMs) {
  const visible = new Map(deviceGarments(db, nowMs).map((g) => [g.id, g]));
  return hotRanking(db, nowMs)
    .filter((r) => !r.removed && visible.has(r.garmentId) && (r.pinned || r.tryonCount > 0))
    .slice(0, HOT_TOP_N)
    .map((r) => ({ ...visible.get(r.garmentId), tryonCount: r.tryonCount }));
}

/** 后台热门榜：按榜单顺序，移出的排最后；visible 表示当前设备是否可见（不可见的不会出现在设备榜单） */
export function adminHot(db, nowMs) {
  const visible = new Set(deviceGarments(db, nowMs).map((g) => g.id));
  const info = db.prepare(
    `SELECT g.title, m.brand_name FROM garment g JOIN merchant m ON m.account_id = g.merchant_id
      WHERE g.id = ? AND g.deleted_at IS NULL`,
  );
  const out = [];
  for (const r of hotRanking(db, nowMs)) {
    const g = info.get(r.garmentId);
    if (!g) continue;
    out.push({ garmentId: r.garmentId, title: g.title, brandName: g.brand_name, tryonCount: r.tryonCount, pinned: r.pinned, removed: r.removed, visible: visible.has(r.garmentId) });
    if (out.length >= 500) break;
  }
  return out;
}

export function dramaView(d) {
  return {
    id: d.id,
    title: d.title,
    posterUrl: assetUrl(d.poster_key),
    garmentIds: JSON.parse(d.garment_ids),
    sort: d.sort,
    enabled: Boolean(d.enabled),
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

/** 设备短剧专题：只要启用的；garmentIds 只保留设备可见服饰，保持专题内顺序 */
export function deviceDramas(db, nowMs) {
  const visible = new Set(deviceGarments(db, nowMs).map((g) => g.id));
  return db
    .prepare('SELECT * FROM drama WHERE enabled = 1 ORDER BY sort, id')
    .all()
    .map((d) => ({ id: d.id, title: d.title, posterUrl: assetUrl(d.poster_key), garmentIds: JSON.parse(d.garment_ids).filter((id) => visible.has(id)) }));
}
