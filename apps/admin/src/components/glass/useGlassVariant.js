import { computed, ref } from 'vue';

/**
 * 毛玻璃组件的 light / dark 变体。
 * 未传 variant 时跟随 html.dark（由 theme.js 的 applyTheme 切换），全局只挂一个 MutationObserver。
 */
const isDark = ref(false);
let observing = false;

function observe() {
  if (observing || typeof document === 'undefined') return;
  observing = true;
  const root = document.documentElement;
  const sync = () => {
    isDark.value = root.classList.contains('dark');
  };
  sync();
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
}

/** 各组件共用的 variant prop：'light' | 'dark'，不传则跟随主题 */
export const variantProp = {
  type: String,
  default: undefined,
  validator: (v) => v === 'light' || v === 'dark',
};

/** 返回实际生效的变体（computed：'light' | 'dark'） */
export function useGlassVariant(props) {
  observe();
  return computed(() => props.variant || (isDark.value ? 'dark' : 'light'));
}
