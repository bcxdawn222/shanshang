import { ref } from 'vue';

/**
 * 商家后台黑 / 白主题（SET-04）：只切换后台自身界面，存 localStorage，不影响设备背景（DVC-03）。
 * 用 Element Plus 暗色变量（main.js 引入 dark/css-vars.css）+ html.dark。总后台始终白色。
 */
const KEY = 'sl_merchant_theme';

function read() {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export const merchantTheme = ref(read());

/** 按当前角色应用主题：只有商家后台才可能是暗色 */
export function applyTheme(role) {
  document.documentElement.classList.toggle('dark', role === 'merchant' && merchantTheme.value === 'dark');
}

export function setMerchantTheme(value) {
  merchantTheme.value = value === 'dark' ? 'dark' : 'light';
  try {
    localStorage.setItem(KEY, merchantTheme.value);
  } catch {
    // 隐私模式等写不进去，只在本次生效
  }
  applyTheme('merchant');
}
