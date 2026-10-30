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

/** 积分流水类型（接口约定 Phase 3 §1） */
export const LEDGER_TYPE_TEXT = {
  ADMIN_ADD: '平台加积分',
  ADMIN_DEDUCT: '平台扣积分',
  TRYON_CONSUME: '试穿消耗',
  REFUND: '退还',
};

export const LEDGER_TYPE_TAG = {
  ADMIN_ADD: 'success',
  ADMIN_DEDUCT: 'warning',
  TRYON_CONSUME: 'info',
  REFUND: 'primary',
};

/** 快照状态（接口约定 Phase 5 §4）；作废（预约后未上传）也按 expired 返回 */
export const SNAPSHOT_STATE_TEXT = {
  valid: '可核销',
  redeemed: '已核销',
  expired: '已过期',
};

export const SNAPSHOT_STATE_TAG = {
  valid: 'success',
  redeemed: 'info',
  expired: 'warning',
};

/** 留言反馈状态（SET-07） */
export const FEEDBACK_STATUS_TEXT = {
  pending: '待处理',
  replied: '已回复',
};

export const FEEDBACK_STATUS_TAG = {
  pending: 'warning',
  replied: 'success',
};

/** 毫秒时长 → 时:分:秒 */
export function fmtDuration(ms) {
  const total = Math.max(Math.floor((ms || 0) / 1000), 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${Math.floor(total / 3600)}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`;
}

/** 积分显示：保留 2 位小数；signed 时正数带 + */
export function fmtPoints(v, signed = false) {
  const n = Number(v ?? 0);
  const s = n.toFixed(2);
  return signed && n > 0 ? `+${s}` : s;
}

export function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
