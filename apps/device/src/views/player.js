import { mediaUrl } from '../api.js';
import { getDeviceConfig } from '../config.js';
import { h } from '../dom.js';
import { getPlaylist, mediaSource, refreshPlaylist } from '../playlist.js';
import { startDeviceSession } from '../session.js';

/**
 * 待机播放页：视频 / 图片混排按顺序循环，两个图层交替淡入。
 *   图片停留 seconds 秒；视频 muted + playsinline + autoplay，播完即切。
 *   素材优先读 Cache Storage（断网可播），列表变化（version 不同）时从头播新列表。
 *   列表为空或素材全部加载失败时显示平台名 / Logo 待机画面，定时看本地列表是否有了内容。
 * 触摸屏幕立即回到首页；离开时开启新的设备会话。本页不连接摄像头。
 */
const FADE_MS = 800;
const LOAD_TIMEOUT_MS = 20_000;
const VIDEO_MAX_MS = 30 * 60_000; // 视频卡住不触发 ended 时的兜底
const FAIL_GAP_MS = 1000;
const STANDBY_CHECK_MS = 30_000;

let active = false;

/** 供空闲计时判断：已经在播放页就不重复进入 */
export const isPlayerActive = () => active;

function withTimeout(promise, ms) {
  let t = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error('加载超时')), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

function loadImage(slot, src) {
  const img = h('img', { class: 'player-media', alt: '', draggable: 'false' });
  img.src = src;
  slot.append(img);
  return withTimeout(img.decode(), LOAD_TIMEOUT_MS).then(() => img);
}

function loadVideo(slot, src) {
  const video = document.createElement('video');
  video.className = 'player-media';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('disablepictureinpicture', '');
  slot.append(video);
  const ready = new Promise((resolve, reject) => {
    video.addEventListener('canplay', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('视频无法播放')), { once: true });
  });
  video.src = src;
  return withTimeout(ready, LOAD_TIMEOUT_MS)
    .then(() => video.play())
    .then(() => video);
}

export const playerEntry = {
  fullscreen: true,
  render(root, nav) {
    active = true;
    let disposed = false;
    let list = getPlaylist();
    let index = -1;
    let failures = 0;
    let front = 0;
    let token = 0;
    let timer = null;

    const slots = [h('div', { class: 'player-slot' }), h('div', { class: 'player-slot' })];
    const revokes = [null, null];
    const standby = h('div', { class: 'player-standby', hidden: true });
    const stage = h('div', { class: 'player', 'aria-label': '待机播放，触摸屏幕开始' }, slots, standby);
    root.append(stage);

    // 触摸即回首页：按下就离开，首页按钮收不到这次 pointerdown，不会误触发
    const exit = () => nav.home();
    stage.addEventListener('pointerdown', exit);

    function clearSlot(i) {
      for (const v of slots[i].querySelectorAll('video')) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
      slots[i].replaceChildren();
      revokes[i]?.();
      revokes[i] = null;
    }

    function showStandby() {
      clearTimeout(timer);
      token += 1;
      slots.forEach((slot, i) => {
        slot.classList.remove('show');
        clearSlot(i);
      });
      const cfg = getDeviceConfig();
      standby.replaceChildren(
        cfg.logoUrl ? h('img', { class: 'standby-logo', src: mediaUrl(cfg.logoUrl), alt: '', draggable: 'false' }) : null,
        h('p', { class: 'standby-name' }, cfg.platformName),
        h('p', { class: 'standby-tip' }, '触摸屏幕，开始实时试穿'),
      );
      standby.hidden = false;
      timer = setTimeout(restart, STANDBY_CHECK_MS);
    }

    function restart() {
      if (disposed) return;
      list = getPlaylist();
      index = -1;
      failures = 0;
      void next();
    }

    async function next() {
      if (disposed) return;
      clearTimeout(timer);
      const latest = getPlaylist();
      if (latest.version !== list.version) {
        list = latest;
        index = -1;
        failures = 0;
      }
      if (!list.items.length || failures >= list.items.length) return showStandby();

      index = (index + 1) % list.items.length;
      const item = list.items[index];
      const my = ++token;
      const back = 1 - front;
      clearSlot(back);
      try {
        const source = await mediaSource(item);
        if (disposed || my !== token) return source.revoke();
        revokes[back] = source.revoke;
        const el =
          item.type === 'video' ? await loadVideo(slots[back], source.src) : await loadImage(slots[back], source.src);
        if (disposed || my !== token) return;

        standby.hidden = true;
        slots[back].classList.add('show');
        slots[front].classList.remove('show');
        const old = front;
        front = back;
        setTimeout(() => {
          if (!disposed && my === token) clearSlot(old);
        }, FADE_MS);
        failures = 0;

        if (item.type === 'image') {
          timer = setTimeout(next, item.seconds * 1000);
        } else {
          const done = () => {
            if (my === token) void next();
          };
          el.addEventListener('ended', done, { once: true });
          el.addEventListener('error', done, { once: true });
          timer = setTimeout(done, VIDEO_MAX_MS);
        }
      } catch (error) {
        if (disposed || my !== token) return;
        console.warn('[player] 素材播放失败，跳过', item.assetId, error?.message || error);
        clearSlot(back);
        failures += 1;
        timer = setTimeout(next, FAIL_GAP_MS);
      }
    }

    void next();
    // 进入时顺带刷新一次列表；当前在待机画面而新列表有内容就立即开播
    void refreshPlaylist().then(() => {
      if (!disposed && !standby.hidden) restart();
    });

    return () => {
      disposed = true;
      active = false;
      token += 1;
      clearTimeout(timer);
      stage.removeEventListener('pointerdown', exit);
      clearSlot(0);
      clearSlot(1);
      startDeviceSession();
    };
  },
};
