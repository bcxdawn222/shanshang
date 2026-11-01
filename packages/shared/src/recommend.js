/**
 * AI智趣推荐（FUN-06、FUN-07）：规则算法，不接大模型。
 * 步骤：性别过滤 → 排除已推荐 → 标签打分 → 种子扰动 → MMR 多样性重排 → 按商家分桶轮流取。
 * garment 字段与设备接口一致：{ id, merchantId, category, color, scenes[], gender }
 */

// 扰动幅度：最高分的 15%，只打破同分、不颠覆排序
const JITTER_RATIO = 0.15;

/** 场合 / 感觉 → 场景、主色权重（管理员可增删，此为预置默认值） */
export const DEFAULT_RECOMMEND_OPTIONS = {
  occasions: [
    { key: 'date', label: '约会局', scenes: { 约会: 3, 休闲: 1 }, colors: { 粉色: 1, 红色: 1, 白色: 0.5 } },
    { key: 'besties', label: '闺蜜局', scenes: { 闺蜜: 3, 休闲: 1, 旅行拍照: 0.5 }, colors: { 粉色: 0.5, 黄色: 0.5 } },
    { key: 'parents', label: '见家长', scenes: { 见家长: 3, 通勤: 0.5 }, colors: { 米色: 1, 白色: 1, 棕色: 0.5 } },
    { key: 'interview', label: '面试', scenes: { 面试: 3, 通勤: 1.5 }, colors: { 白色: 1, 黑色: 1, 灰色: 1 } },
    { key: 'birthday', label: '生日派对', scenes: { 生日派对: 3, 宴会: 1 }, colors: { 红色: 1, 紫色: 1, 粉色: 0.5 } },
    { key: 'travel', label: '旅行拍照', scenes: { 旅行拍照: 3, 休闲: 1 }, colors: { 黄色: 1, 蓝色: 1, 白色: 0.5 } },
    { key: 'commute', label: '通勤', scenes: { 通勤: 3, 面试: 0.5 }, colors: { 灰色: 1, 黑色: 0.5, 米色: 0.5 } },
    { key: 'sport', label: '运动', scenes: { 运动: 3, 休闲: 1 }, colors: { 白色: 0.5, 蓝色: 0.5, 绿色: 0.5 } },
  ],
  feelings: [
    { key: 'gentle', label: '温柔', scenes: { 约会: 0.5 }, colors: { 粉色: 2, 米色: 2, 白色: 1 } },
    { key: 'cool', label: '酷飒', scenes: { 运动: 0.5 }, colors: { 黑色: 2, 灰色: 1, 红色: 1 } },
    { key: 'classy', label: '高级', scenes: { 宴会: 1 }, colors: { 黑色: 1.5, 灰色: 1, 棕色: 1, 紫色: 1 } },
    { key: 'energetic', label: '元气', scenes: { 运动: 0.5, 生日派对: 0.5 }, colors: { 黄色: 2, 橙色: 2, 绿色: 1 } },
    { key: 'relaxed', label: '松弛', scenes: { 休闲: 1.5, 旅行拍照: 0.5 }, colors: { 米色: 1, 绿色: 1, 蓝色: 1 } },
  ],
};

/** 合并多个选项的权重（同名相加）：mergeWeights(occasion, feeling) → { scenes, colors, categories } */
export function mergeWeights(...options) {
  const out = { scenes: {}, colors: {}, categories: {} };
  for (const opt of options) {
    if (!opt) continue;
    for (const kind of Object.keys(out)) {
      for (const [name, w] of Object.entries(opt[kind] ?? {})) out[kind][name] = (out[kind][name] ?? 0) + w;
    }
  }
  return out;
}

/** 标签打分：命中场景权重之和 + 主色权重 + 品类权重 */
export function scoreGarment(g, weights = {}) {
  let score = 0;
  for (const sc of g.scenes ?? []) score += weights.scenes?.[sc] ?? 0;
  score += weights.colors?.[g.color] ?? 0;
  score += weights.categories?.[g.category] ?? 0;
  return score;
}

/** 相似度：同商家、同品类、同主色三项的命中比例 */
export function similarity(a, b) {
  return ((a.merchantId === b.merchantId) + (a.category === b.category) + (a.color === b.color)) / 3;
}

/** MMR 重排：每步选 λ·相关度 − (1−λ)·与已选最大相似度 最大者；相关度归一化到 [0,1] */
function mmr(list, lambda) {
  const max = Math.max(...list.map((x) => x.score));
  const min = Math.min(...list.map((x) => x.score));
  const span = max - min || 1;
  const rest = list.map((x) => ({ ...x, rel: (x.score - min) / span, maxSim: 0 }));
  const out = [];
  while (rest.length) {
    let best = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < rest.length; i += 1) {
      const val = lambda * rest[i].rel - (1 - lambda) * rest[i].maxSim;
      if (val > bestVal) {
        bestVal = val;
        best = i;
      }
    }
    const [chosen] = rest.splice(best, 1);
    out.push(chosen);
    for (const x of rest) x.maxSim = Math.max(x.maxSim, similarity(x.g, chosen.g));
  }
  return out;
}

/** 按商家分桶，桶内保持 MMR 顺序，桶按首次出现顺序轮流取 */
function roundRobinByMerchant(list) {
  const buckets = new Map();
  for (const x of list) {
    if (!buckets.has(x.g.merchantId)) buckets.set(x.g.merchantId, []);
    buckets.get(x.g.merchantId).push(x);
  }
  const queues = [...buckets.values()];
  const out = [];
  for (let round = 0; out.length < list.length; round += 1) {
    for (const q of queues) if (round < q.length) out.push(q[round]);
  }
  return out;
}

/**
 * 推荐：返回 { items, exhausted }。候选（同性别且不在 exclude 中）为空时 exhausted = true，
 * 调用方提示“已经为你推荐完全部搭配”并清空该问题的 exclude。
 */
export function recommend(garments, { gender, weights = {}, rng = Math.random, count = 6, exclude = new Set(), lambda = 0.7 } = {}) {
  const pool = garments.filter((g) => (!gender || g.gender === gender) && !exclude.has(g.id));
  if (!pool.length) return { items: [], exhausted: true };

  const scored = pool.map((g) => ({ g, score: scoreGarment(g, weights) }));
  const amp = JITTER_RATIO * (Math.max(...scored.map((x) => x.score)) || 1);
  // 按原顺序逐个取 rng，同种子同输入结果一致
  for (const x of scored) x.score += rng() * amp;

  const ordered = roundRobinByMerchant(mmr(scored, lambda));
  return { items: ordered.slice(0, count).map((x) => x.g), exhausted: false };
}

/**
 * 轮盘 / 幸运色匹配：cell = { label, color?, scene? }，返回 3~6 件服饰数组。
 * 先在主色或场景命中的服饰里推荐，不足时用其余同性别服饰补齐（不重复）。
 */
export function matchWheel(garments, cell, { gender, rng = Math.random, count = 6 } = {}) {
  const n = Math.max(3, Math.min(6, count));
  const pool = garments.filter((g) => !gender || g.gender === gender);
  const hit = (g) => (cell.color && g.color === cell.color) || (cell.scene && (g.scenes ?? []).includes(cell.scene));
  const weights = { colors: cell.color ? { [cell.color]: 1 } : {}, scenes: cell.scene ? { [cell.scene]: 1 } : {} };

  const matched = recommend(pool.filter(hit), { weights, rng, count: n }).items;
  if (matched.length >= n) return matched;
  const filler = recommend(pool, { weights, rng, count: n - matched.length, exclude: new Set(matched.map((g) => g.id)) }).items;
  return [...matched, ...filler];
}
