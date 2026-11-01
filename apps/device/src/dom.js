import { bindTap } from './tap.js';

/** 极简元素构造：文本一律走 textContent/Text 节点，不拼 HTML */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

export function button(content, onTap, cls = 'btn') {
  const el = h('button', { type: 'button', class: cls }, content);
  bindTap(el, onTap);
  return el;
}

let toastTimer = null;

export function toast(message, ms = 2600) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}
