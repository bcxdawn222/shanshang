/**
 * 转盘运动学（纯函数，无 DOM，node 可直接自检）。
 * 角度单位弧度，rotation 为转盘相对初始位置顺时针转过的角度（canvas y 轴朝下，正角 = 顺时针）。
 * 指针固定在正上方；格 i 在转盘坐标里占 [i·seg, (i+1)·seg)，从正上方顺时针量。
 *
 * 一次转动分两段，终点在启动前就由种子定好：
 *   1. 摩擦段：初速度 v0 匀减速到 w1（距离 = 总距离 − settle）；
 *   2. 落定段：剩余 settle 角度按 cubic-bezier(.3,.92,.2,1) 缓动，时长由 w1 反推，两段衔接处速度连续。
 * 总距离 = 到目标格的最短同向距离 + 若干整圈，保证摩擦段大约持续 minSpinMs。
 */
export const TAU = Math.PI * 2;
export const SETTLE_BEZIER = [0.3, 0.92, 0.2, 1];

const mod = (x, m) => ((x % m) + m) % m;

/** CSS 同款 cubic-bezier：返回 x ∈ [0,1] → y */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dsx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-7) return sy(t);
      const d = dsx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
      if (t < 0 || t > 1) break;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (hi - lo > 1e-7) {
      if (sx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

const settleEase = cubicBezier(...SETTLE_BEZIER);
// 曲线在起点的斜率 dy/dx = y1 / x1，用来让落定段的初速度等于摩擦段末速度
const SETTLE_SLOPE0 = SETTLE_BEZIER[1] / SETTLE_BEZIER[0];

/** 指针当前指着的格子下标 */
export function indexAt(rotation, n) {
  const seg = TAU / n;
  return Math.min(n - 1, Math.floor(mod(-rotation, TAU) / seg));
}

/** 让指针落在第 index 格内 frac（0~1）位置时的 rotation（模 2π） */
export function restAngle(index, n, frac = 0.5) {
  return mod(-(index + frac) * (TAU / n), TAU);
}

/**
 * 规划一次转动。v0：初速度（rad/s，取绝对值）；dir：1 顺时针 / -1 逆时针。
 * 返回的 plan 交给 angleAt / velocityAt 按时间取值。
 */
export function planSpin({ from = 0, index, n, v0, dir = 1, frac = 0.5, settleCells = 1.2, settleMs = 1200, minSpinMs = 3200 }) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`格数不合法：${n}`);
  if (!Number.isInteger(index) || index < 0 || index >= n) throw new RangeError(`目标格不合法：${index}`);
  const d = dir < 0 ? -1 : 1;
  const seg = TAU / n;
  const f = Math.min(0.9, Math.max(0.1, frac));
  const target = restAngle(index, n, f);
  const delta = d > 0 ? mod(target - from, TAU) : mod(from - target, TAU);

  const settle = settleCells * seg;
  const t2 = settleMs / 1000;
  const w1 = (SETTLE_SLOPE0 * settle) / t2;
  const v = Math.max(Math.abs(v0) || 0, w1 * 1.5);
  const minDist = ((v + w1) / 2) * (minSpinMs / 1000) + settle;
  const turns = Math.max(0, Math.ceil((minDist - delta) / TAU));
  const dist = delta + turns * TAU;
  const d1 = dist - settle;
  const decel = (v * v - w1 * w1) / (2 * d1);
  const t1 = (v - w1) / decel;
  return { from, to: from + d * dist, dir: d, dist, settle, v0: v, w1, decel, t1, t2, duration: t1 + t2, index, n };
}

/** t 秒时的 rotation */
export function angleAt(plan, t) {
  if (t <= 0) return plan.from;
  if (t >= plan.duration) return plan.to;
  if (t < plan.t1) return plan.from + plan.dir * (plan.v0 * t - (plan.decel * t * t) / 2);
  const base = plan.from + plan.dir * (plan.dist - plan.settle);
  return base + plan.dir * plan.settle * settleEase((t - plan.t1) / plan.t2);
}

/** t 秒时的角速度绝对值（rad/s），用于拨片力度和“嗒”声音量 */
export function velocityAt(plan, t) {
  if (t <= 0) return plan.v0;
  if (t >= plan.duration) return 0;
  if (t < plan.t1) return plan.v0 - plan.decel * t;
  const x = (t - plan.t1) / plan.t2;
  const hx = 1e-4;
  const x0 = Math.min(x, 1 - hx);
  return ((settleEase(x0 + hx) - settleEase(x0)) / hx) * (plan.settle / plan.t2);
}
