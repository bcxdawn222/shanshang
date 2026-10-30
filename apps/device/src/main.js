import './style.css';
import { clearIdentity, errorMessage, loadIdentity, mediaUrl, request, saveIdentity, setToken } from './api.js';
import { h } from './dom.js';
import { invalidateGarments } from './garments.js';
import { createRouter } from './router.js';
import { flushSegments } from './segments.js';
import { homeEntry } from './views/home.js';

const POLL_MS = 5000; // 未绑定时轮询绑定状态
const BOUND_POLL_MS = 60_000; // 已绑定后低频确认没被停用
const RETRY_MS = 15000;
const HEARTBEAT_MS = 30_000;

const view = document.getElementById('view');
const brand = document.getElementById('brand');
const router = createRouter(view);

let identity = null;
let mode = null; // null | 'pending' | 'bound' | 'disabled' | 'error'
let heartbeatTimer = null;

// ───────── 主题（总后台按设备下发 black / white） ─────────

function applyBackground(background) {
  const theme = background === 'white' ? 'white' : 'black';
  document.body.classList.toggle('theme-white', theme === 'white');
  document.body.classList.toggle('theme-black', theme === 'black');
}

function applyConfig(cfg) {
  if (!cfg) return;
  applyBackground(cfg.background);
  const name = cfg.platformName || '闪裳Live';
  document.title = name;
  const children = [];
  if (cfg.logoUrl) {
    children.push(h('img', { class: 'brand-logo', src: mediaUrl(cfg.logoUrl), alt: '', draggable: 'false' }));
  }
  children.push(h('span', {}, name));
  brand.replaceChildren(...children);
}

async function loadConfig() {
  try {
    const { status, data } = await request('device/config');
    if (status === 200) applyConfig(data);
  } catch (error) {
    console.warn('[config] 获取设备配置失败', error?.message || error);
  }
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
  void loadConfig();
  void flushSegments();
  router.reset(homeEntry);
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

applyBackground('black');
renderMessage([{ text: '正在连接…' }]);
tick();
