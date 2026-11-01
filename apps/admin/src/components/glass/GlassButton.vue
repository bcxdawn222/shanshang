<template>
  <button
    :type="nativeType"
    class="g-btn glass-hover"
    :class="[`glass-${v}`, `g-btn--${type}`, { 'is-loading': loading }]"
    :disabled="disabled || loading"
    :aria-busy="loading ? 'true' : undefined"
  >
    <span v-if="loading" class="g-btn__spinner" aria-hidden="true" />
    <span class="g-btn__label"><slot /></span>
  </button>
</template>

<script setup>
/**
 * 毛玻璃按钮：原生 <button>，Tab 可聚焦、Enter / 空格触发，focus-visible 有描边。
 * type 是视觉类型；原生 type 用 nativeType（默认 button，避免在表单里误提交）。
 * loading 时禁用并显示转圈，aria-busy="true"。
 */
import { useGlassVariant, variantProp } from './useGlassVariant.js';

defineOptions({ name: 'GlassButton' });

const props = defineProps({
  variant: variantProp,
  type: {
    type: String,
    default: 'default',
    validator: (t) => ['primary', 'default', 'danger'].includes(t),
  },
  nativeType: {
    type: String,
    default: 'button',
    validator: (t) => ['button', 'submit', 'reset'].includes(t),
  },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
});
const v = useGlassVariant(props);
</script>

<style scoped>
.g-btn {
  --glass-u-bg: var(--glass-c-field);
  --glass-u-bg-hover: var(--glass-c-field-hover);
  --glass-u-border: var(--glass-c-edge);
  --glass-u-blur: var(--glass-c-blur);
  --glass-u-saturate: var(--glass-c-saturate);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  min-height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--glass-u-text);
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.g-btn--primary,
.g-btn--danger {
  --glass-u-border: var(--glass-u-light-border);
  color: var(--glass-c-on-accent);
}
.g-btn--primary {
  --glass-u-bg: var(--glass-c-primary-bg);
  --glass-u-bg-hover: var(--glass-c-primary-bg-hover);
  box-shadow: var(--glass-c-primary-shadow);
}
.g-btn--danger {
  --glass-u-bg: var(--glass-c-danger-bg);
  --glass-u-bg-hover: var(--glass-c-danger-bg-hover);
  box-shadow: var(--glass-c-danger-shadow);
}
.g-btn:focus-visible {
  outline: 2px solid var(--glass-c-focus);
  outline-offset: 2px;
}
.g-btn:not(:disabled):active {
  transform: scale(0.98);
}
.g-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.g-btn.is-loading {
  opacity: 0.8;
  cursor: progress;
}
.g-btn__spinner {
  width: 14px;
  height: 14px;
  box-sizing: border-box;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: g-btn-spin 0.8s linear infinite;
}
@keyframes g-btn-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .g-btn__spinner {
    animation-duration: 2s;
  }
  .g-btn:not(:disabled):active {
    transform: none;
  }
}
</style>
