import { button, h } from '../dom.js';
import { failure, loading } from './layout.js';

/** 三个玩法页共用：性别选项、异步加载骨架、星级、大按钮网格 */
export const GENDER_OPTIONS = [
  { key: 'female', label: '女士', sub: '流行女装' },
  { key: 'male', label: '男士', sub: '流行男装' },
  { key: 'kid', label: '童装', sub: '小朋友' },
];

export const genderLabel = (key) => GENDER_OPTIONS.find((g) => g.key === key)?.label || '';

// FUN-01：推荐不足 3 件时如实提示，不跨性别补（同性别补齐由 matchWheel 负责）
export const MIN_RECOMMEND = 3;
export const SHORT_TEXT = '当前上新款式较少，先看看这几款';
export const isShort = (items) => items.length > 0 && items.length < MIN_RECOMMEND;

/** 异步加载内容：页面离开后不再渲染，失败可重试。返回 cleanup */
export function runAsync(body, load, render) {
  let alive = true;
  const run = async () => {
    loading(body);
    try {
      const value = await load();
      if (alive) render(value);
    } catch (error) {
      if (!alive) return;
      console.error('[fun]', error);
      failure(body, error instanceof TypeError ? '网络异常，请稍后再试' : error.message || '加载失败', run);
    }
  };
  void run();
  return () => {
    alive = false;
  };
}

/** 1~5 星，读屏读“几星” */
export function starText(n) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  return h('span', { class: 'stars', 'aria-label': `${v} 星` }, '★'.repeat(v) + '☆'.repeat(5 - v));
}

/** 大按钮网格：items = [{ icon?, label, sub?, onTap }]，cols 3 / 4 / 7 */
export function pickGrid(items, cols = 3) {
  return h(
    'div',
    { class: `pick-grid cols-${cols}` },
    items.map(({ icon, label, sub, onTap }) =>
      button(
        [
          icon ? h('span', { class: 'pick-icon', 'aria-hidden': 'true' }, icon) : null,
          h('span', { class: 'pick-label' }, label),
          sub ? h('span', { class: 'pick-sub' }, sub) : null,
        ],
        onTap,
        'btn pick',
      ),
    ),
  );
}
