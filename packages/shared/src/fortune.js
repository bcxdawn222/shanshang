import { seededRng } from './rng.js';
import { zodiacOf } from './zodiac.js';

/**
 * 运势穿搭（FUN-04、FUN-05）。rng = seededRng(日期, 月-日, 模块名)，同一生日同一天结果相同。
 * 文案采用“模板句 × 词槽”：按综合星级分档（high ≥4 / mid =3 / low ≤2）选模板，再逐个填词槽。
 * 内置模板 {zodiac}、{color} 由程序填入，其余词槽从 slots 中按种子选取。
 */
export const DEFAULT_FORTUNE_LIBRARY = {
  templates: {
    high: [
      '{opener}，{zodiac}今天{energy}，{action}，穿上{color}好运加倍。',
      '{zodiac}的你{energy}，{action}；一身{color}让今天更闪亮。',
      '{opener}，{advice}，{color}会把你的好状态放大。',
    ],
    mid: [
      '{opener}，{advice}，一抹{color}帮你稳住节奏。',
      '{zodiac}今天{mood}，不过{action}，{color}是你的安全感。',
      '平稳的一天，{advice}，搭配{color}刚刚好。',
    ],
    low: [
      '{opener}，{zodiac}今天{mood}，{advice}，试试{color}给自己打打气。',
      '小插曲难免，{advice}；{color}会悄悄守住你的好心情。',
      '{zodiac}今天{mood}，{advice}，穿点{color}换个心情。',
    ],
  },
  slots: {
    opener: ['晨光正好', '风向转暖', '云开见月', '小船顺风', '街角有花开', '日子慢慢变甜'],
    energy: ['状态在线', '气场全开', '灵感不断', '人缘很旺', '自带光芒'],
    mood: ['心思有点飘', '节奏略慢', '容易想太多', '需要一点耐心', '有点小纠结'],
    action: ['主动开口会有惊喜', '适合尝试新造型', '把想法说出来', '约朋友出去走走', '大胆一点没关系'],
    advice: ['慢一点反而更顺', '把注意力留给重要的人', '整理好细节再出发', '给自己留一段独处时间', '少一点比较多一点自信'],
  },
  // 今日幸运色候选（{label, color}，可直接当轮盘格传给 matchWheel）
  luckyColors: [
    { label: '经典黑', color: '黑色' }, { label: '纯净白', color: '白色' }, { label: '高级灰', color: '灰色' },
    { label: '奶油米', color: '米色' }, { label: '摩卡棕', color: '棕色' }, { label: '热情红', color: '红色' },
    { label: '温柔粉', color: '粉色' }, { label: '活力橙', color: '橙色' }, { label: '阳光黄', color: '黄色' },
    { label: '森林绿', color: '绿色' }, { label: '天空蓝', color: '蓝色' }, { label: '梦幻紫', color: '紫色' },
  ],
};

// 星级分布略偏中高，避免顾客频繁看到 1 星
const STAR_TABLE = [1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5];
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 今日运势卡：{ zodiac, stars: { overall, love, career }, text, luckyColor: { label, color } }
 * library 可整体或部分覆盖（templates / slots / luckyColors）
 */
export function fortune({ dateStr, month, day, module = 'fortune', library } = {}) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) throw new RangeError(`日期格式应为 YYYY-MM-DD：${dateStr}`);
  const zodiac = zodiacOf(month, day);
  const lib = { ...DEFAULT_FORTUNE_LIBRARY, ...library };
  const rng = seededRng(dateStr, `${pad2(month)}-${pad2(day)}`, module);

  // 调用 rng 的顺序固定，保证确定性
  const stars = { overall: pick(rng, STAR_TABLE), love: pick(rng, STAR_TABLE), career: pick(rng, STAR_TABLE) };
  const luckyColor = pick(rng, lib.luckyColors);
  const tier = stars.overall >= 4 ? 'high' : stars.overall === 3 ? 'mid' : 'low';
  const templates = lib.templates[tier]?.length ? lib.templates[tier] : Object.values(lib.templates).flat();
  const template = pick(rng, templates);

  const text = template.replace(/\{(\w+)\}/g, (raw, slot) => {
    if (slot === 'zodiac') return zodiac.name;
    if (slot === 'color') return luckyColor.label;
    const words = lib.slots?.[slot];
    return words?.length ? pick(rng, words) : raw;
  });

  return { zodiac, stars, text, luckyColor };
}
