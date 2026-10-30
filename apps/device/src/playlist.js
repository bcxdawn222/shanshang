import { mediaUrl, request } from './api.js';

/**
 * 待机播放列表：GET /api/device/playlist → { version, items: [{ assetId, type, url, seconds }] }。
 * 列表存 localStorage，素材按 version 预缓存到 Cache Storage（每个版本一个 cache，旧版本缓存清掉）。
 * 接口失败 / 404 / 断网时沿用上一份列表和已缓存素材。没有自动重试：由调用方的定时刷新（5 分钟）兜底。
 */
const LIST_KEY = 'shanshang.playlist.v1';
const CACHE_PREFIX = 'shanshang-media-';
const EMPTY = Object.freeze({ version: '', items: [] });

const hasCaches = () => typeof caches !== 'undefined';
const cacheName = (version) => CACHE_PREFIX + (version || 'none');

function clampSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(120, Math.round(n)) : 8;
}

function normalize(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    version: String(data?.version ?? ''),
    items: items
      .filter((i) => i && (i.type === 'video' || i.type === 'image') && typeof i.url === 'string' && i.url)
      .map((i) => ({ assetId: i.assetId, type: i.type, url: i.url, seconds: clampSeconds(i.seconds) })),
  };
}

export function getPlaylist() {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) || 'null');
    if (v && Array.isArray(v.items)) return normalize(v);
  } catch {
    /* 损坏就当没有 */
  }
  return EMPTY;
}

function saveList(list) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch (error) {
    console.warn('[playlist] 保存列表失败', error);
  }
}

/**
 * 逐个缓存素材：先看本版本 cache，再从旧版本 cache 复制，最后才下载。
 * 返回 false 表示中途断网：调用方不切换列表、不删旧缓存，下次刷新从断点续上。
 */
async function precache(list) {
  if (!hasCaches()) return true;
  const cache = await caches.open(cacheName(list.version));
  for (const item of list.items) {
    const url = mediaUrl(item.url);
    try {
      if (await cache.match(url)) continue;
      const old = await caches.match(url);
      if (old) {
        await cache.put(url, old);
        continue;
      }
      const res = await fetch(url);
      if (res.status === 200) await cache.put(url, res);
      else console.warn('[playlist] 素材下载失败', res.status, item.assetId);
    } catch (error) {
      console.warn('[playlist] 素材缓存失败', item.assetId, error?.message || error);
      if (error instanceof TypeError) return false; // 断网：剩下的等下次刷新
    }
  }
  return true;
}

async function dropOldCaches(keepVersion) {
  if (!hasCaches()) return;
  const keep = keepVersion == null ? null : cacheName(keepVersion);
  for (const name of await caches.keys()) {
    if (name.startsWith(CACHE_PREFIX) && name !== keep) await caches.delete(name);
  }
}

let refreshing = null;

/** 拉一次列表并预缓存；任何失败都返回本地已有列表 */
export function refreshPlaylist() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const { status, data } = await request('device/playlist');
      if (status !== 200) {
        if (status !== 404) console.warn('[playlist] 获取播放列表失败', status);
        return getPlaylist();
      }
      const next = normalize(data);
      if (!next.items.length) {
        saveList(next);
        await dropOldCaches(null);
        return next;
      }
      // 先缓存新版本再切换列表，播放中的旧列表不受影响；部分失败的素材下次刷新补齐
      if (!(await precache(next))) return getPlaylist();
      saveList(next);
      await dropOldCaches(next.version);
      return next;
    } catch (error) {
      console.warn('[playlist] 刷新失败，沿用本地列表', error?.message || error);
      return getPlaylist();
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** 播放源：命中缓存用 blob URL（断网可播），否则直接走网络 */
export async function mediaSource(item) {
  const url = mediaUrl(item.url);
  if (hasCaches()) {
    try {
      const hit = await caches.match(url);
      if (hit) {
        const objectUrl = URL.createObjectURL(await hit.blob());
        return { src: objectUrl, revoke: () => URL.revokeObjectURL(objectUrl) };
      }
    } catch (error) {
      console.warn('[playlist] 读取缓存失败', error?.message || error);
    }
  }
  return { src: url, revoke() {} };
}
