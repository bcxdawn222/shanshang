import { button, h } from '../dom.js';

/** 二级页通用骨架：返回 / 返回首页 + 标题，内容区由调用方填充 */
export function pageShell(root, nav, { title, subtitle } = {}) {
  const body = h('div', { class: 'page-body' });
  root.append(
    h(
      'div',
      { class: 'page' },
      h(
        'header',
        { class: 'page-head' },
        button('‹ 返回', () => nav.back(), 'btn btn-ghost'),
        h('div', { class: 'page-title' }, h('h2', {}, title || ''), subtitle ? h('p', {}, subtitle) : null),
        button('返回首页', () => nav.home(), 'btn btn-ghost'),
      ),
      body,
    ),
  );
  return body;
}

export function loading(body, text = '正在加载…') {
  body.replaceChildren(h('p', { class: 'page-msg' }, text));
}

export function failure(body, message, retry) {
  body.replaceChildren(
    h('p', { class: 'page-msg error' }, message),
    retry ? button('重新加载', retry, 'btn btn-primary') : null,
  );
}

/** 大按钮选项列表：[{ label, sub, onTap }] */
export function optionList(items) {
  return h(
    'div',
    { class: 'options' },
    items.map(({ label, sub, onTap }) =>
      button([h('span', { class: 'opt-label' }, label), sub ? h('span', { class: 'opt-sub' }, sub) : null], onTap, 'btn option'),
    ),
  );
}
