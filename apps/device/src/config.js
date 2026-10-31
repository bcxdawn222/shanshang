/**
 * 设备配置（GET /api/device/config）的本地副本。
 * 存一份到 localStorage：断网开机时待机画面仍能显示平台名，空闲/试穿上限仍按上次下发的值。
 */
const STORAGE_KEY = 'shanshang.config.v1';
const DEFAULTS = Object.freeze({
  platformName: '闪裳Live',
  logoUrl: '',
  background: 'black',
  tryonMaxMinutes: 5,
  idleMinutes: 4,
});

function intIn(value, min, max, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function normalize(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  return {
    platformName: typeof c.platformName === 'string' && c.platformName.trim() ? c.platformName : DEFAULTS.platformName,
    logoUrl: typeof c.logoUrl === 'string' ? c.logoUrl : '',
    background: c.background === 'white' ? 'white' : 'black',
    tryonMaxMinutes: intIn(c.tryonMaxMinutes, 1, 30, DEFAULTS.tryonMaxMinutes),
    idleMinutes: intIn(c.idleMinutes, 1, 60, DEFAULTS.idleMinutes),
  };
}

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return { ...DEFAULTS };
  }
}

let state = load();

export function getDeviceConfig() {
  return state;
}

export function setDeviceConfig(cfg) {
  state = normalize(cfg);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 存不下不影响使用 */
  }
  return state;
}
