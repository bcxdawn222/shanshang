import { randomInt } from 'node:crypto';
import { randomToken } from './tokens.js';

/**
 * 试穿快照与 6 位核销短码（Phase 5，RDM-01~05）。口径见 docs/03-接口与集成/Phase5-接口约定.md。
 * 时间一律毫秒时间戳；不记录顾客任何身份信息。
 */

// 快照有效期：生成后 7 天
export const SNAPSHOT_TTL_MS = 7 * 24 * 3600_000;
// 预约后 10 分钟内必须上传图片，否则作废
export const UPLOAD_WINDOW_MS = 10 * 60_000;
// 快照图片单张上限
export const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;

/** 公开链接令牌：32 字节（256 bit）随机数，base64url */
export function newSnapshotToken() {
  return randomToken(32);
}

/** 6 位数字短码（含前导 0） */
export function randomSnapshotCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * “仍占用短码”的快照条件：未核销、未清理、未过期，且已上传图片或还在 10 分钟上传窗口内。
 * 参数用命名参数 @now、@voidBefore（= now - UPLOAD_WINDOW_MS）
 */
export const ACTIVE_SQL = `(s.redeemed_at IS NULL AND s.purged_at IS NULL AND s.expires_at > @now
  AND (s.image_key IS NOT NULL OR s.created_at > @voidBefore))`;

/** 可核销的条件（已上传图片、未核销、未清理、未过期），参数 @now */
export const VALID_SQL = `(s.redeemed_at IS NULL AND s.purged_at IS NULL AND s.expires_at > @now AND s.image_key IS NOT NULL)`;

/**
 * 内部状态：
 * - redeemed：已核销（优先，过期后仍显示已核销）
 * - expired：已过期、已清理，或预约 10 分钟仍未上传（作废）
 * - pending：已预约、还在上传窗口内，尚未上传图片
 * - valid：可核销
 */
export function snapshotStatus(row, nowMs) {
  if (row.redeemed_at) return 'redeemed';
  if (row.purged_at || row.expires_at <= nowMs) return 'expired';
  if (!row.image_key) return row.created_at + UPLOAD_WINDOW_MS <= nowMs ? 'expired' : 'pending';
  return 'valid';
}

/** 对外 state 只有 valid / redeemed / expired；上传中的快照不可核销，对外也算 expired */
export function publicState(row, nowMs) {
  const s = snapshotStatus(row, nowMs);
  return s === 'pending' ? 'expired' : s;
}

/** 图片是否还能访问：已上传、未清理、未过期（已核销但没过期的也能看） */
export function imageAvailable(row, nowMs) {
  return Boolean(row.image_key) && !row.purged_at && row.expires_at > nowMs;
}

/** 部署前缀：取 PUBLIC_BASE_URL 的路径部分（如 https://example.com/sl → /sl），未配置为空串 */
export function basePath(config) {
  if (!config.publicBaseUrl) return '';
  try {
    return new URL(config.publicBaseUrl).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** 对外的站点根地址：PUBLIC_BASE_URL；未配置时按请求推算（仅本地开发） */
export function publicOrigin(config, request) {
  return config.publicBaseUrl || `${request.protocol}://${request.host}`;
}

/** 快照公开链接 */
export function snapshotUrl(config, request, token) {
  return `${publicOrigin(config, request)}/s/${encodeURIComponent(token)}`;
}

/** 快照页“商家核销”链接：后台是 hash 路由，#/ 不能省 */
export function redeemUrl(config, request, token) {
  return `${publicOrigin(config, request)}/admin/#/merchant/redeem?token=${encodeURIComponent(token)}`;
}

/**
 * 给后台用的图片地址：以 / 开头的绝对路径（含部署前缀，如 /sl/s/<token>/image），
 * 后台 mediaUrl() 对 / 开头的路径原样使用；不可访问时为空串
 */
export function imagePath(config, row, nowMs) {
  return imageAvailable(row, nowMs) ? `${basePath(config)}/s/${encodeURIComponent(row.token)}/image` : '';
}

/**
 * 过期清理：删除过期快照的图片并写 purged_at；预约 10 分钟仍未上传的作废快照也一并标记。
 * 单张删除失败时跳过，下次再试。返回 { purged }
 */
export async function purgeExpiredSnapshots(ctx) {
  const { db, storage, now } = ctx;
  const t = now();
  const select = db.prepare(
    `SELECT id, image_key FROM snapshot
      WHERE purged_at IS NULL AND (expires_at <= ? OR (image_key IS NULL AND created_at <= ?))
        AND id > ?
      ORDER BY id LIMIT 500`,
  );
  const mark = db.prepare('UPDATE snapshot SET purged_at = ? WHERE id = ? AND purged_at IS NULL');
  let purged = 0;
  let lastId = 0;
  for (;;) {
    const rows = select.all(t, t - UPLOAD_WINDOW_MS, lastId);
    if (!rows.length) break;
    for (const r of rows) {
      lastId = r.id;
      if (r.image_key) {
        try {
          await storage.remove(r.image_key);
        } catch {
          continue;
        }
      }
      purged += mark.run(t, r.id).changes;
    }
  }
  return { purged };
}
