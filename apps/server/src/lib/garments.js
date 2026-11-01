import { HttpError } from './http.js';
import { MIME_BY_EXT } from './images.js';
import { getPointsConfig, toMilli } from './points.js';
import { uploadImage } from './xmax.js';

export const GENDERS = { female: '女', male: '男', kid: '童' };
export const SET_TYPES = { suit: '当季热卖套装', single: '上装单品' };

// 审核期：上传后随机 50~70 分钟自动上架，平均约 1 小时，最长不超过 2 小时（GAR-07）
export const REVIEW_DELAY_MIN_MS = 50 * 60_000;
export const REVIEW_DELAY_MAX_MS = 70 * 60_000;

/** 审核期已到、无人处理的服饰自动上架。列表接口查询前调用，不依赖定时任务 */
export function promoteDue(db, nowMs) {
  db.prepare(
    `UPDATE garment SET status = 'ready', updated_at = ?
      WHERE status = 'reviewing' AND available_at <= ? AND deleted_at IS NULL`,
  ).run(nowMs, nowMs);
}

/**
 * 设备可见服饰（设备服饰清单、热门榜、短剧专题共用同一口径）：
 * 未删除、已上架、审核期已到、商家审核通过且余额不低于隐藏阈值。会先把到期的审核期服饰转上架。
 * 返回设备端视图数组，按商家、id 排序。
 */
export function deviceGarments(db, nowMs) {
  promoteDue(db, nowMs);
  const dicts = loadDicts(db);
  const name = (id) => dicts.get(id)?.name ?? '';
  const rows = db
    .prepare(
      `SELECT g.*, m.brand_name, m.shop_location AS merchant_location
         FROM garment g
         JOIN account a ON a.id = g.merchant_id
         JOIN merchant m ON m.account_id = g.merchant_id
        WHERE g.deleted_at IS NULL AND g.status = 'ready' AND g.available_at <= ? AND a.status = 'approved'
          AND m.balance_milli >= ?
        ORDER BY g.merchant_id, g.id`,
    )
    .all(nowMs, toMilli(getPointsConfig(db).hideThreshold));
  return rows.map((g) => ({
    id: g.id,
    merchantId: g.merchant_id,
    brandName: g.brand_name,
    title: g.title,
    gender: g.gender,
    setType: g.set_type,
    category: name(g.category_id),
    color: name(g.color_id),
    scenes: JSON.parse(g.scene_ids).map(name).filter(Boolean),
    discountText: g.discount_text,
    shopLocation: g.shop_location || g.merchant_location,
    imagePath: `media/${g.image_key}`,
    xmaxUrl: g.xmax_url,
  }));
}

export function loadDicts(db) {
  const rows = db.prepare('SELECT id, kind, name, enabled, sort FROM dict_item ORDER BY kind, sort, id').all();
  return new Map(rows.map((r) => [r.id, r]));
}

export function slotUsage(db, merchantId) {
  const quota = db.prepare('SELECT slot_quota FROM merchant WHERE account_id = ?').pluck().get(merchantId) ?? 0;
  const used = db
    .prepare('SELECT COUNT(*) FROM garment WHERE merchant_id = ? AND deleted_at IS NULL')
    .pluck()
    .get(merchantId);
  return { quota, used };
}

export function slotFullError() {
  return new HttpError(409, 'SLOT_FULL', '服饰格位已用完，请联系管理员');
}

export function garmentView(g, dicts) {
  const name = (id) => dicts.get(id)?.name ?? '';
  const sceneIds = JSON.parse(g.scene_ids);
  return {
    id: g.id,
    merchantId: g.merchant_id,
    title: g.title,
    gender: g.gender,
    setType: g.set_type,
    categoryId: g.category_id,
    category: name(g.category_id),
    colorId: g.color_id,
    color: name(g.color_id),
    sceneIds,
    scenes: sceneIds.map(name).filter(Boolean),
    discountText: g.discount_text,
    shopLocation: g.shop_location,
    imagePath: `media/${g.image_key}`,
    xmaxReady: Boolean(g.xmax_url),
    status: g.status,
    availableAt: g.available_at,
    offlineBy: g.offline_by,
    reviewNote: g.review_note,
    reviewedAt: g.reviewed_at,
    createdAt: g.created_at,
  };
}

/** 校验上传表单（multipart 字段都是字符串）。字典项必须存在且启用 */
export function parseGarmentFields(dicts, f) {
  const bad = (message) => new HttpError(400, 'BAD_REQUEST', message);
  const text = (v) => (typeof v === 'string' ? v.trim() : '');

  const title = text(f.title);
  if (!title || title.length > 40) throw bad('请填写服饰名称（40 字以内）');
  if (!Object.hasOwn(GENDERS, f.gender)) throw bad('请选择性别');
  if (!Object.hasOwn(SET_TYPES, f.setType)) throw bad('请选择类型（当季热卖套装 / 上装单品）');

  const dictId = (value, kind, label) => {
    const id = Number(value);
    const item = Number.isInteger(id) ? dicts.get(id) : null;
    if (!item || item.kind !== kind || !item.enabled) throw bad(`请选择${label}`);
    return id;
  };
  const categoryId = dictId(f.categoryId, 'category', '品类');
  const colorId = dictId(f.colorId, 'color', '主色');
  const sceneIds = [
    ...new Set(
      text(f.sceneIds)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].map((v) => dictId(v, 'scene', '有效的场景标签'));
  if (sceneIds.length > 10) throw bad('场景标签最多 10 个');

  const discountText = text(f.discountText);
  if (discountText.length > 60) throw bad('折扣说明最多 60 字');
  const shopLocation = text(f.shopLocation);
  if (shopLocation.length > 60) throw bad('店铺位置最多 60 字');

  return { title, gender: f.gender, setType: f.setType, categoryId, colorId, sceneIds, discountText, shopLocation };
}

/** 原图转存到 Xmax；失败返回 null，不阻断上传（设备端会用官方 SDK 兜底上传） */
export async function tryXmaxUpload(ctx, buffer, mime, log) {
  try {
    return await uploadImage(ctx, buffer, mime);
  } catch (error) {
    log?.warn({ code: error.code }, 'xmax upload failed, device will fall back to sdk upload');
    return null;
  }
}

/** 给还没有 Xmax 地址的服饰补传一次（管理员审核通过时调用） */
export async function retryXmaxUpload(ctx, garment, log) {
  if (garment.xmax_url) return garment.xmax_url;
  const ext = garment.image_key.split('.').pop();
  let buffer;
  try {
    buffer = await ctx.storage.read(garment.image_key);
  } catch {
    return null;
  }
  const url = await tryXmaxUpload(ctx, buffer, MIME_BY_EXT[ext], log);
  if (url) ctx.db.prepare('UPDATE garment SET xmax_url = ? WHERE id = ?').run(url, garment.id);
  return url;
}
