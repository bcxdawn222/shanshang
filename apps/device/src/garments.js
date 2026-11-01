import { errorMessage, request } from './api.js';

/** 设备服饰清单，短时缓存，层级间来回切换不重复拉取；客户端按性别/类型/品牌/品类筛选 */
const TTL_MS = 60_000;
let cache = null;

export async function loadGarments({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.items;
  const { status, data } = await request('device/garments');
  if (status !== 200) throw new Error(errorMessage(data, `获取服饰失败（${status}）`));
  const items = Array.isArray(data?.items) ? data.items : [];
  cache = { at: Date.now(), items };
  return items;
}

export function invalidateGarments() {
  cache = null;
}

export const isBanquet = (g) => Array.isArray(g.scenes) && g.scenes.some((s) => String(s).includes('宴会'));

/** 按 key 分组，保持首次出现顺序 */
export function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}
