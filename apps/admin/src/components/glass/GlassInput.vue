<template>
  <div class="g-field" :class="[`g-field--${v}`, { 'is-error': !!error, 'is-disabled': disabled }, attrs.class]" :style="attrs.style">
    <label v-if="label" class="g-field__label" :for="inputId">{{ label }}</label>
    <input
      v-bind="inputAttrs"
      :id="inputId"
      class="g-field__input"
      :class="`glass-${v}`"
      :type="type"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
      @input="onInput"
    />
    <p v-if="error" :id="errorId" class="g-field__error" role="alert">{{ error }}</p>
  </div>
</template>

<script setup>
/**
 * 毛玻璃输入框。v-model 绑定字符串；label 与 input 通过 for / id 关联，
 * error 非空时显示提示，并通过 aria-describedby + aria-invalid 告知读屏。
 * class / style 加在外层，其余属性（name、autocomplete、maxlength…）透传到 <input>。
 */
import { computed, useAttrs, useId } from 'vue';
import { useGlassVariant, variantProp } from './useGlassVariant.js';

defineOptions({ name: 'GlassInput', inheritAttrs: false });

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  variant: variantProp,
  label: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  type: { type: String, default: 'text' },
  error: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  /** 不传则自动生成 */
  id: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const v = useGlassVariant(props);
const attrs = useAttrs();
const autoId = useId();
const inputId = computed(() => props.id || `glass-input-${autoId}`);
const errorId = computed(() => `${inputId.value}-error`);
const inputAttrs = computed(() => {
  // eslint-disable-next-line no-unused-vars
  const { class: _c, style: _s, ...rest } = attrs;
  return rest;
});

function onInput(e) {
  emit('update:modelValue', e.target.value);
}
</script>

<style scoped>
/* 外层不挂 .glass-* 类（不需要玻璃面），label / 错误文字颜色按变体单独取 */
.g-field {
  --g-field-label: var(--glass-u-light-text);
  --g-field-error: var(--glass-c-light-danger-text);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.g-field--dark {
  --g-field-label: var(--glass-u-dark-text);
  --g-field-error: var(--glass-c-dark-danger-text);
}
.g-field__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--g-field-label);
}
.g-field__input {
  --glass-u-bg: var(--glass-c-field);
  --glass-u-bg-hover: var(--glass-c-field-hover);
  --glass-u-border: var(--glass-c-edge);
  --glass-u-blur: var(--glass-c-blur);
  --glass-u-saturate: var(--glass-c-saturate);
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  font: inherit;
  font-size: 14px;
  color: var(--glass-u-text);
  outline: none;
  transition:
    border-color var(--glass-u-duration) ease,
    box-shadow var(--glass-u-duration) ease,
    background-color var(--glass-u-duration) ease;
}
.g-field__input::placeholder {
  color: var(--glass-u-text-muted);
  opacity: 1;
}
.g-field__input:not(:disabled):hover {
  background-color: var(--glass-u-bg-hover);
}
.g-field__input:focus-visible,
.g-field__input:focus {
  border-color: var(--glass-c-focus);
  box-shadow: 0 0 0 3px var(--glass-c-focus-ring);
}
.is-error .g-field__input {
  border-color: var(--glass-c-danger-text);
}
.is-error .g-field__input:focus {
  box-shadow: 0 0 0 3px var(--glass-c-danger-ring);
}
.g-field__input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.g-field__error {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--g-field-error);
}
@media (prefers-reduced-motion: reduce) {
  .g-field__input {
    transition: none;
  }
}
</style>
