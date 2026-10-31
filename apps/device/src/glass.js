import { button, h } from './dom.js';

/**
 * 毛玻璃组件（样式见 glass.css）。文本一律走 h() 的 textContent，不拼 HTML；触摸统一 bindTap（经 button()）。
 * variant: 'light' | 'dark'，不传时跟随 body 主题（theme-black → dark，theme-white → light，主题切换实时生效）。
 * 所有工厂都接受可选 class，追加到根元素上。
 */
const VARIANTS = { light: 'glass-light', dark: 'glass-dark' };
const KINDS = {
  primary: 'btn btn-primary glass-btn glass-btn-primary',
  danger: 'btn btn-danger glass-btn glass-btn-danger',
};

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;
const cx = (...names) => names.filter(Boolean).join(' ');
const variantClass = (variant) => VARIANTS[variant] || '';
const isText = (value) => typeof value === 'string' || typeof value === 'number';
const isEmpty = (value) => value == null || value === false || value === '';

/** 玻璃卡片。header 为字符串时渲染成标题，为节点时原样放进卡片头 */
export function glassCard({ variant, header, children, class: extra } = {}) {
  let head = null;
  if (!isEmpty(header)) {
    head = isText(header)
      ? h('h3', { class: 'glass-card-title' }, String(header))
      : h('div', { class: 'glass-card-head' }, header);
  }
  return h(
    'section',
    { class: cx('glass', variantClass(variant), 'glass-card', extra) },
    head,
    h('div', { class: 'glass-card-body' }, children ?? []),
  );
}

/**
 * 玻璃按钮，最小 64×64。kind：
 *   default → 玻璃底（有 backdrop-filter，别放进另一块玻璃或实时画面上）
 *   primary / danger → 实色渐变（沿用 .btn-primary / .btn-danger，白字对比度有保证，无模糊）
 */
export function glassButton(label, onTap, { variant, kind = 'default', disabled = false, class: extra } = {}) {
  const base = KINDS[kind] || cx('btn glass glass-hover glass-btn', variantClass(variant));
  const el = button(label, typeof onTap === 'function' ? onTap : () => {}, cx(base, extra));
  el.disabled = Boolean(disabled);
  return el;
}

/** 带 label 的玻璃输入框，返回外层 .glass-field；input 可用 el.querySelector('input') 取到 */
export function glassInput({ label, placeholder, type = 'text', value, onInput, variant, class: extra } = {}) {
  const id = nextId('glass-input');
  const hasLabel = !isEmpty(label);
  const input = h('input', {
    id,
    class: cx('glass', variantClass(variant), 'glass-input'),
    type: type || 'text',
    placeholder: isEmpty(placeholder) ? null : String(placeholder),
    autocomplete: 'off',
    'aria-label': hasLabel || isEmpty(placeholder) ? null : String(placeholder),
  });
  if (value != null) input.value = String(value);
  if (typeof onInput === 'function') input.addEventListener('input', (event) => onInput(input.value, event));
  return h(
    'div',
    { class: cx('glass-field', extra) },
    hasLabel ? h('label', { class: 'glass-field-label', for: id }, isText(label) ? String(label) : label) : null,
    input,
  );
}

/**
 * 玻璃弹层：遮罩（只压暗，不模糊）+ 玻璃卡片 + 64px 关闭按钮。返回 { el, open, close, isOpen }。
 * el 由调用方挂到页面上（初始隐藏）。open()/close() 幂等，close() 不触发回调；
 * 用户点关闭按钮（或按 Esc）时先 close() 再调用 onClose()。
 */
export function glassModal({ variant, title, children, onClose, class: extra } = {}) {
  const titleId = nextId('glass-modal-title');
  const hasTitle = !isEmpty(title);
  let restoreFocus = null;

  function userClose() {
    close();
    if (typeof onClose === 'function') onClose();
  }

  const closeBtn = button('✕', userClose, 'btn btn-ghost glass-modal-close');
  closeBtn.setAttribute('aria-label', '关闭');

  const el = h(
    'div',
    {
      class: cx('glass-modal', extra),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': hasTitle ? titleId : null,
      hidden: true,
    },
    h(
      'div',
      { class: cx('glass', variantClass(variant), 'glass-modal-card') },
      h(
        'div',
        { class: 'glass-modal-head' },
        h('span', { 'aria-hidden': 'true' }),
        hasTitle ? h('h2', { id: titleId, class: 'glass-modal-title' }, isText(title) ? String(title) : title) : h('span'),
        closeBtn,
      ),
      h('div', { class: 'glass-modal-body' }, children ?? []),
    ),
  );

  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || el.hidden) return;
    event.preventDefault();
    userClose();
  });

  function open() {
    if (!el.hidden) return;
    restoreFocus = document.activeElement;
    el.hidden = false;
    try {
      closeBtn.focus({ preventScroll: true });
    } catch {
      /* 未挂到文档上时忽略 */
    }
  }

  function close() {
    if (el.hidden) return;
    el.hidden = true;
    const prev = restoreFocus;
    restoreFocus = null;
    if (prev && prev.isConnected && !prev.disabled && typeof prev.focus === 'function') {
      try {
        prev.focus({ preventScroll: true });
      } catch {
        /* 忽略 */
      }
    }
  }

  return { el, open, close, isOpen: () => !el.hidden };
}

/** 玻璃顶栏：左 / 中 / 右三栏。title 为字符串时渲染成 h2，为节点时原样放进中栏 */
export function glassNavbar({ title, left, right, variant, class: extra } = {}) {
  let center = null;
  if (!isEmpty(title)) center = isText(title) ? h('h2', { class: 'glass-navbar-title' }, String(title)) : title;
  return h(
    'header',
    { class: cx('glass', variantClass(variant), 'glass-navbar', extra) },
    h('div', { class: 'glass-navbar-side glass-navbar-left' }, left ?? []),
    h('div', { class: 'glass-navbar-center' }, center),
    h('div', { class: 'glass-navbar-side glass-navbar-right' }, right ?? []),
  );
}
