import { DEFAULT_FORTUNE_LIBRARY, DEFAULT_RECOMMEND_OPTIONS, DEFAULT_ZODIAC_WHEEL, ZODIACS } from '@shanshang/shared';
import { request } from './api.js';

/**
 * 玩法配置（GET /api/device/fun/config）：{ zodiacWheel, recommendOptions, fortuneLibrary }。
 * 任一字段为 null / 形状不对，或接口 404 / 失败时，用 packages/shared 的默认值。
 * 成功结果缓存 60 秒；失败只缓存 15 秒，接口恢复后很快生效。
 */
const TTL_MS = 60_000;
const FAIL_TTL_MS = 15_000;
const WHEEL_MAX_CELLS = 12;

let cache = null;

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

function normalizeWheel(raw) {
  const out = {};
  for (const z of ZODIACS) {
    const cells = isObject(raw) && Array.isArray(raw[z.key]) ? raw[z.key] : null;
    const valid =
      cells &&
      cells.length >= 2 &&
      cells.every((c) => isObject(c) && isText(c.label) && (isText(c.color) || isText(c.scene)));
    out[z.key] = valid ? cells.slice(0, WHEEL_MAX_CELLS) : DEFAULT_ZODIAC_WHEEL[z.key];
  }
  return out;
}

function normalizeOptions(raw) {
  const group = (name) => {
    const list = isObject(raw) && Array.isArray(raw[name]) ? raw[name] : null;
    const valid = list && list.length && list.every((o) => isObject(o) && (isText(o.key) || Number.isFinite(o.key)) && isText(o.label));
    return valid ? list : DEFAULT_RECOMMEND_OPTIONS[name];
  };
  return { occasions: group('occasions'), feelings: group('feelings') };
}

function normalizeLibrary(raw) {
  const lib = { ...DEFAULT_FORTUNE_LIBRARY };
  if (!isObject(raw)) return lib;
  if (isObject(raw.templates)) {
    const all = Object.values(raw.templates).flat();
    if (all.length && all.every(isText)) lib.templates = raw.templates;
  }
  if (isObject(raw.slots)) lib.slots = { ...DEFAULT_FORTUNE_LIBRARY.slots, ...raw.slots };
  if (Array.isArray(raw.luckyColors) && raw.luckyColors.length && raw.luckyColors.every((c) => isObject(c) && isText(c.label) && isText(c.color))) {
    lib.luckyColors = raw.luckyColors;
  }
  return lib;
}

export function normalizeFunConfig(raw) {
  const c = isObject(raw) ? raw : {};
  return {
    zodiacWheel: normalizeWheel(c.zodiacWheel),
    recommendOptions: normalizeOptions(c.recommendOptions),
    fortuneLibrary: normalizeLibrary(c.fortuneLibrary),
  };
}

export async function loadFunConfig() {
  if (cache && Date.now() < cache.until) return cache.value;
  let raw = null;
  let ok = false;
  try {
    const { status, data } = await request('device/fun/config');
    if (status === 200 && isObject(data)) {
      raw = data;
      ok = true;
    } else {
      console.warn('[fun] 获取玩法配置失败，使用默认值', status);
    }
  } catch (error) {
    console.warn('[fun] 获取玩法配置失败，使用默认值', error?.message || error);
  }
  const value = normalizeFunConfig(raw);
  cache = { value, until: Date.now() + (ok ? TTL_MS : FAIL_TTL_MS) };
  return value;
}

/** 本地日期 YYYY-MM-DD（种子用，按设备所在时区算“今天”） */
export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 主色字典名 → 色值（转盘格、幸运色色块用） */
const COLOR_HEX = {
  黑色: '#26262e',
  白色: '#f4f4f6',
  灰色: '#9aa0a8',
  米色: '#e8dcc2',
  棕色: '#8b5a3c',
  红色: '#e5384a',
  粉色: '#ff8fb5',
  橙色: '#ff8a3d',
  黄色: '#ffd23f',
  绿色: '#3fb97a',
  蓝色: '#3d8bff',
  紫色: '#9b5de5',
};

export function colorHex(name) {
  return COLOR_HEX[name] || null;
}
