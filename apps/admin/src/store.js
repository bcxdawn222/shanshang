import { reactive } from 'vue';
import { api } from './api.js';

/** 全局状态：当前账号 + 平台设置（平台名、Logo、登录背景） */
export const store = reactive({
  account: null,
  loaded: false,
  settings: { platformName: '闪裳Live', logoUrl: '', loginBgUrl: '' },
});

export async function loadMe() {
  try {
    store.account = (await api('auth/me')).account;
  } catch {
    store.account = null;
  }
  store.loaded = true;
  return store.account;
}

export async function loadPublicSettings() {
  try {
    Object.assign(store.settings, await api('settings/public'));
    document.title = `${store.settings.platformName} 后台`;
  } catch {
    // 拿不到就用默认值
  }
}

export async function logout() {
  await api('auth/logout', { method: 'POST' }).catch(() => {});
  store.account = null;
}

export const STATUS_TEXT = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
  disabled: '已停用',
  bound: '已绑定',
};

export const STATUS_TAG = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  disabled: 'info',
  bound: 'success',
};

export function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
