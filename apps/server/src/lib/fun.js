import { HttpError } from './http.js';

/**
 * Phase 6 玩法配置（FUN-03、FUN-06、ADM-07）：星座轮盘映射、AI 推荐选项、运势文案库覆盖。
 * 服务端只存管理员保存的 JSON，不引用 packages/shared；未配置时返回 null，由设备端回落到共享默认值。
 * 数据形状与 packages/shared 一致，设备可直接传给 matchWheel / mergeWeights：
 *   轮盘格 { label, color } 或 { label, scene }（二选一，名称来自标签字典）
 *   推荐选项 { key, label, scenes: {场景: 权重}, colors: {主色: 权重}, categories: {品类: 权重} }
 */
export const FUN_KEYS = {
  zodiacWheel: 'zodiac_wheel',
  recommendOptions: 'recommend_options',
  fortuneLibrary: 'fortune_library',
};

// 与 packages/shared/src/zodiac.js 的 ZODIACS 顺序和 key 一致（fun.test.js 里核对）
export const ZODIACS = [
  { key: 'capricorn', name: '摩羯座' },
  { key: 'aquarius', name: '水瓶座' },
  { key: 'pisces', name: '双鱼座' },
  { key: 'aries', name: '白羊座' },
  { key: 'taurus', name: '金牛座' },
  { key: 'gemini', name: '双子座' },
  { key: 'cancer', name: '巨蟹座' },
  { key: 'leo', name: '狮子座' },
  { key: 'virgo', name: '处女座' },
  { key: 'libra', name: '天秤座' },
  { key: 'scorpio', name: '天蝎座' },
  { key: 'sagittarius', name: '射手座' },
];
export const ZODIAC_KEYS = ZODIACS.map((z) => z.key);

export const WHEEL_MIN_CELLS = 8;
export const WHEEL_MAX_CELLS = 12;
export const LABEL_MAX = 10;
export const OPTION_MAX = 12;
export const WEIGHT_MAX = 10;
// 推荐选项的三类权重 → 标签字典 kind
export const WEIGHT_KINDS = { scenes: 'scene', colors: 'color', categories: 'category' };

const bad = (code, message) => new HttpError(400, code, message);

/** 读一项配置：{ configured, value, updatedAt } */
export function getFun(db, field) {
  const row = db.prepare('SELECT value, updated_at FROM fun_config WHERE key = ?').get(FUN_KEYS[field]);
  return row
    ? { configured: true, value: JSON.parse(row.value), updatedAt: row.updated_at }
    : { configured: false, value: null, updatedAt: null };
}

export function setFun(db, field, value, actorId, now) {
  db.prepare(
    `INSERT INTO fun_config (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(FUN_KEYS[field], JSON.stringify(value), actorId, now);
}

export function resetFun(db, field) {
  db.prepare('DELETE FROM fun_config WHERE key = ?').run(FUN_KEYS[field]);
}

/** 设备玩法配置：未配置的字段为 null */
export function deviceFunConfig(db) {
  const rows = db.prepare('SELECT key, value FROM fun_config').all();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  return Object.fromEntries(Object.entries(FUN_KEYS).map(([field, key]) => [field, byKey[key] ?? null]));
}

/** 标签字典里的名称（含已停用：停用只影响商家上传，已有服饰仍带着这些标签） */
function dictNames(db) {
  const out = { category: new Set(), scene: new Set(), color: new Set() };
  for (const r of db.prepare('SELECT kind, name FROM dict_item').all()) out[r.kind].add(r.name);
  return out;
}

const KIND_TEXT = { scene: '场景', color: '主色', category: '品类' };

/** 校验并规整星座轮盘（结构、长度、数量已由 JSON schema 校验） */
export function normalizeWheel(db, body) {
  const dicts = dictNames(db);
  const out = {};
  for (const z of ZODIACS) {
    const seen = new Set();
    out[z.key] = body[z.key].map((cell, i) => {
      const where = `${z.name}第 ${i + 1} 格`;
      const label = cell.label.trim();
      if (!label) throw bad('BAD_REQUEST', `${where}：名称不能为空`);
      if (seen.has(label)) throw bad('BAD_REQUEST', `${where}：名称「${label}」重复`);
      seen.add(label);
      const hasColor = cell.color !== undefined;
      if (hasColor === (cell.scene !== undefined)) throw bad('BAD_REQUEST', `${where}：幸运色和幸运风格只能选一个`);
      const kind = hasColor ? 'color' : 'scene';
      const value = cell[kind];
      if (!dicts[kind].has(value)) throw bad('UNKNOWN_TAG', `${where}：${KIND_TEXT[kind]}「${value}」不在标签字典里`);
      return { label, [kind]: value };
    });
  }
  return out;
}

const GROUP_TEXT = { occasions: '场合', feelings: '感觉' };

/** 校验并规整 AI 推荐选项：组内 key、名称不重复，权重名称必须在标签字典里，每个选项至少一项权重 */
export function normalizeOptions(db, body) {
  const dicts = dictNames(db);
  const out = {};
  for (const group of Object.keys(GROUP_TEXT)) {
    const keys = new Set();
    const labels = new Set();
    out[group] = body[group].map((opt, i) => {
      const where = `${GROUP_TEXT[group]}第 ${i + 1} 项`;
      const label = opt.label.trim();
      if (!label) throw bad('BAD_REQUEST', `${where}：名称不能为空`);
      if (keys.has(opt.key)) throw bad('BAD_REQUEST', `${where}：标识「${opt.key}」重复`);
      if (labels.has(label)) throw bad('BAD_REQUEST', `${where}：名称「${label}」重复`);
      keys.add(opt.key);
      labels.add(label);
      const item = { key: opt.key, label };
      let count = 0;
      for (const [field, kind] of Object.entries(WEIGHT_KINDS)) {
        const weights = opt[field] ?? {};
        for (const name of Object.keys(weights)) {
          if (!dicts[kind].has(name)) throw bad('UNKNOWN_TAG', `${where}「${label}」：${KIND_TEXT[kind]}「${name}」不在标签字典里`);
        }
        count += Object.keys(weights).length;
        item[field] = { ...weights };
      }
      if (!count) throw bad('BAD_REQUEST', `${where}「${label}」：至少设置一项权重`);
      return item;
    });
  }
  return out;
}
