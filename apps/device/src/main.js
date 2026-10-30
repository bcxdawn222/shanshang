import './style.css';

// 接口地址按构建 base 计算：线上 /sl/device/ → /sl/api/，开发时 / → /api/
const API_BASE = new URL('../api/', new URL(import.meta.env.BASE_URL, location.origin)).pathname;
const STORAGE_KEY = 'shanshang.device';
const POLL_MS = 5000;
const RETRY_MS = 15000;

const view = document.getElementById('view');

function loadIdentity() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return v?.code && v?.token ? v : null;
  } catch {
    return null;
  }
}

function saveIdentity(identity) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

async function request(path, { method = 'GET', token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { method, headers });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function render(lines) {
  view.replaceChildren(
    ...lines.map(({ text, cls }) => {
      const el = document.createElement(cls === 'code' ? 'div' : 'p');
      if (cls) el.className = cls;
      el.textContent = text;
      return el;
    }),
  );
}

function showPending(code) {
  render([
    { text: '设备尚未绑定' },
    { text: code, cls: 'code' },
    { text: '请平台管理员在「总后台 → 设备管理 → 绑定设备」录入上方设备码', cls: 'hint' },
  ]);
}

function showBound({ name, location: place }) {
  render([
    { text: '设备已绑定' },
    { text: [name, place].filter(Boolean).join(' · ') || '已就绪' },
    { text: '试穿功能将在后续版本开放', cls: 'hint' },
  ]);
}

function showDisabled(code) {
  render([
    { text: '设备已停用', cls: 'error' },
    { text: code, cls: 'code' },
    { text: '请联系平台管理员', cls: 'hint' },
  ]);
}

function showError(message) {
  render([{ text: message, cls: 'error' }, { text: '稍后自动重试', cls: 'hint' }]);
}

/** 本地没有凭证就注册一台新设备；凭证只存在本机 */
async function ensureIdentity() {
  const existing = loadIdentity();
  if (existing) return existing;
  const { status, data } = await request('device/register', { method: 'POST' });
  if (status !== 201 || !data?.token) throw new Error(data?.error?.message || `设备注册失败（${status}）`);
  const identity = { code: data.code, token: data.token };
  saveIdentity(identity);
  return identity;
}

async function tick() {
  let delay = POLL_MS;
  try {
    const identity = await ensureIdentity();
    const { status, data } = await request('device/status', { token: identity.token });
    if (status === 401) {
      // 服务端不认这台设备（库被重置或凭证失效）：丢掉旧凭证，下一轮重新注册
      clearIdentity();
      delay = 0;
    } else if (status !== 200) {
      throw new Error(data?.error?.message || `查询设备状态失败（${status}）`);
    } else if (data.status === 'bound') {
      showBound(data);
    } else if (data.status === 'disabled') {
      showDisabled(data.code);
    } else {
      showPending(data.code);
    }
  } catch (error) {
    showError(error instanceof TypeError ? '网络异常，正在重新连接…' : error.message);
    delay = RETRY_MS;
  }
  setTimeout(tick, delay);
}

render([{ text: '正在连接…' }]);
tick();
