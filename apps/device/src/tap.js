/**
 * 广告机触摸屏上 click 不可靠（Chromium 会把点击当手势吞掉，尤其整屏有视频层时）。
 * 统一用“按下和抬起是同一个 pointerId”的 pointer 事件，等价于 click；
 * 手指滑动导致浏览器接管滚动时会收到 pointercancel，不会误触发。
 */
export function bindTap(element, handler) {
  if (!element) return;
  let activePointerId = null;
  element.style.touchAction = 'manipulation';
  element.addEventListener('pointerdown', (event) => {
    activePointerId = event.pointerId;
  });
  element.addEventListener('pointerup', (event) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    if (element.disabled) return;
    try {
      handler(event);
    } catch (error) {
      console.error('[tap]', error);
    }
  });
  element.addEventListener('pointercancel', () => {
    activePointerId = null;
  });
  element.addEventListener('pointerleave', () => {
    activePointerId = null;
  });
}
