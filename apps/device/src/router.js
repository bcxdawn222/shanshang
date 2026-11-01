/**
 * 页面栈。每个 entry 是 { render(root, nav) => cleanup?, fullscreen? }。
 * 切页前先执行上一页的 cleanup（试穿页靠它断开会话、结算离屏时长）。
 */
export function createRouter(root) {
  const stack = [];
  let cleanup = null;

  function teardown() {
    if (!cleanup) return;
    const fn = cleanup;
    cleanup = null;
    try {
      fn();
    } catch (error) {
      console.error('[router] cleanup', error);
    }
  }

  function show(entry) {
    teardown();
    root.replaceChildren();
    root.scrollTop = 0;
    document.body.classList.toggle('mode-tryon', Boolean(entry.fullscreen));
    const result = entry.render(root, nav);
    cleanup = typeof result === 'function' ? result : null;
  }

  const nav = {
    push(entry) {
      stack.push(entry);
      show(entry);
    },
    back() {
      if (stack.length <= 1) return nav.home();
      stack.pop();
      show(stack[stack.length - 1]);
    },
    home() {
      if (!stack.length) return;
      stack.length = 1;
      show(stack[0]);
    },
    reset(entry) {
      stack.length = 0;
      nav.push(entry);
    },
    clear() {
      teardown();
      stack.length = 0;
      document.body.classList.remove('mode-tryon');
    },
  };
  return nav;
}
