import { getDeviceConfig } from './config.js';

/**
 * 空闲计时：任意 pointer 事件重置，超过 config.idleMinutes 无操作调用 onIdle。
 * 时长每次重置时读取，后台改了配置下一次操作后即生效。
 */
const EVENTS = ['pointerdown', 'pointermove', 'pointerup'];

export function startIdleWatch(onIdle) {
  let timer = null;

  function reset() {
    clearTimeout(timer);
    timer = setTimeout(fire, getDeviceConfig().idleMinutes * 60_000);
  }

  function fire() {
    try {
      onIdle();
    } catch (error) {
      console.error('[idle]', error);
    }
    reset(); // 继续计时：在播放页里 onIdle 自己判断不重复进入
  }

  for (const type of EVENTS) window.addEventListener(type, reset, { capture: true, passive: true });
  reset();
  return { reset };
}
