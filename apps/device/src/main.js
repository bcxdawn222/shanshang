import './style.css';
import { clearIdentity, errorMessage, loadIdentity, logoSrc, request, saveIdentity, setToken } from './api.js';
import { h } from './dom.js';
import { invalidateGarments } from './garments.js';
import { getDeviceConfig, setDeviceConfig } from './config.js';
import { startIdleWatch } from './idle.js';
import { refreshPlaylist } from './playlist.js';
import { createRouter } from './router.js';
import { flushSegments } from './segments.js';
import { flushEvents } from './events.js';
import { homeEntry } from './views/home.js';
import { isPlayerActive, playerEntry } from './views/player.js';
import { isTryonActive } from './views/tryon.js';

const POLL_MS = 5000; // 未绑定时轮询绑定状态
const BOUND_POLL_MS = 60_000; // 已绑定后低频确认没被停用
const RETRY_MS = 15000;
const HEARTBEAT_MS = 30_000;
const REFRESH_MS = 5 * 60_000; // 定时重拉配置和播放列表，后台改了投放不用重启
const EVENTS_MS = 10_000; // 埋点批量上报间隔（满 50 条时 trackEvent 会提前上报）

const view = document.getElementById('view');
const brand = document.getElementById('brand');
const router = createRouter(view);

let identity = null;
let mode = null; // null | 'pending' | 'bound' | 'disabled' | 'error'
let heartbeatTimer = null;
let refreshTimer = null;
let eventsTimer = null;
let idleWatch = null;

// ───────── 主题（总后台按设备下发 black / white） ─────────

function applyBackground(background) {
  const theme = background === 'white' ? 'white' : 'black';
  document.body.classList.toggle('theme-white', theme === 'white');
  document.body.classList.toggle('theme-black', theme === 'black');
}

function applyConfig(raw) {
  if (!raw) return;
  const cfg = setDeviceConfig(raw);
  applyBackground(cfg.background);
  const name = cfg.platformName || '闪裳Live';
  document.title = name;
  brand.replaceChildren(
    h('img', { class: 'brand-logo', src: logoSrc(cfg.logoUrl), alt: '', draggable: 'false' }),
    h('span', {}, name),
  );
}

async function loadConfig() {
  try {
    const { status, data } = await request('device/config');
    if (status === 200) applyConfig(data);
    else console.warn('[config] 获取设备配置失败，沿用本地配置', status);
  } catch (error) {
    console.warn('[config] 获取设备配置失败，沿用本地配置', error?.message || error);
  }
}

/** 试穿中不下载广告素材，免得和实时画面抢带宽；下一轮再补 */
const inTryon = () => document.body.classList.contains('mode-tryon') && !isPlayerActive();

async function refreshContent() {
  if (mode !== 'bound') return;
  await loadConfig();
  if (!inTryon()) await refreshPlaylist();
}

function startRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => void refreshContent(), REFRESH_MS);
}

// ───────── 空闲：无操作进入待机播放；试穿页的 cleanup 负责 disconnect + 结算离屏 ─────────

function goIdle() {
  // 试穿中不进待机：由试穿时长上限的“点击继续”结束，避免 4 分钟空闲抢在 5 分钟上限之前
  if (mode !== 'bound' || isPlayerActive() || isTryonActive()) return;
  router.reset(homeEntry);
  router.push(playerEntry);
}

// ───────── 心跳：在线状态 + 背景切换 + 顺带补传计费队列 ─────────

async function heartbeat() {
  try {
    const { status, data } = await request('device/heartbeat', { method: 'POST' });
    if (status === 200) applyBackground(data?.background);
  } catch (error) {
    console.warn('[heartbeat] 失败', error?.message || error);
  }
  if (mode === 'bound') void flushSegments();
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  void heartbeat();
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
}

// ───────── 埋点：每 10 秒批量上报一次本地队列；页面卸载时 keepalive 补发 ─────────

function startEvents() {
  if (eventsTimer) return;
  eventsTimer = setInterval(() => {
    if (mode === 'bound') void flushEvents();
  }, EVENTS_MS);
  window.addEventListener('pagehide', () => {
    if (mode === 'bound') void flushEvents({ keepalive: true });
  });
}

// ───────── 未绑定 / 停用 / 错误提示页 ─────────

function renderMessage(lines) {
  router.clear();
  view.replaceChildren(
    h(
      'div',
      { class: 'notice' },
      lines.map(({ text, cls }) => h(cls === 'code' ? 'div' : 'p', { class: cls }, text)),
    ),
  );
}

function showPending(code) {
  renderMessage([
    { text: '设备尚未绑定' },
    { text: code, cls: 'code' },
    { text: '请平台管理员在「总后台 → 设备管理 → 绑定设备」录入上方设备码', cls: 'hint' },
  ]);
}

function showDisabled(code) {
  renderMessage([
    { text: '设备已停用', cls: 'error' },
    { text: code, cls: 'code' },
    { text: '请联系平台管理员', cls: 'hint' },
  ]);
}

function showError(message) {
  renderMessage([{ text: message, cls: 'error' }, { text: '稍后自动重试', cls: 'hint' }]);
}

function enterBound() {
  invalidateGarments();
  void flushSegments();
  void flushEvents(); // 开机 / 重新绑定后补报上次留下的埋点
  startEvents();
  router.reset(homeEntry);
  void refreshContent();
  startRefresh();
  if (!idleWatch) idleWatch = startIdleWatch(goIdle);
  else idleWatch.reset();
}

// ───────── 注册 / 绑定轮询（沿用原流程） ─────────

/** 本地没有凭证就注册一台新设备；凭证只存在本机 */
async function ensureIdentity() {
  const existing = loadIdentity();
  if (existing) return existing;
  const { status, data } = await request('device/register', { method: 'POST', token: null });
  if (status !== 201 || !data?.token) throw new Error(errorMessage(data, `设备注册失败（${status}）`));
  const created = { code: data.code, token: data.token };
  saveIdentity(created);
  return created;
}

function setMode(next, render) {
  if (mode === next && next !== 'error') return;
  mode = next;
  render();
}

async function tick() {
  let delay = POLL_MS;
  try {
    identity = await ensureIdentity();
    setToken(identity.token);
    startHeartbeat();
    const { status, data } = await request('device/status');
    if (status === 401) {
      // 服务端不认这台设备（库被重置或凭证失效）：丢掉旧凭证，下一轮重新注册
      clearIdentity();
      setToken(null);
      identity = null;
      delay = 0;
    } else if (status !== 200) {
      throw new Error(errorMessage(data, `查询设备状态失败（${status}）`));
    } else {
      applyBackground(data.background);
      if (data.status === 'bound') {
        setMode('bound', enterBound);
        delay = BOUND_POLL_MS;
      } else if (data.status === 'disabled') {
        setMode('disabled', () => showDisabled(data.code));
      } else {
        setMode('pending', () => showPending(data.code));
      }
    }
  } catch (error) {
    if (mode === 'bound') {
      // 已在使用中：网络抖动不打断用户，下次再确认
      delay = RETRY_MS;
    } else {
      mode = 'error';
      showError(error instanceof TypeError ? '网络异常，正在重新连接…' : error.message);
      delay = RETRY_MS;
    }
  }
  setTimeout(tick, delay);
}

applyBackground(getDeviceConfig().background);
renderMessage([{ text: '正在连接…' }]);
tick();
