<template>
  <Teleport to="body">
    <Transition name="g-modal">
      <!--
        遮罩只用半透明底色，不加 backdrop-filter：
        1) backdrop-filter 会让元素成为 fixed 后代的包含块（见 glass.css 顶部注释）；
        2) 祖先有 backdrop-filter 时，里面面板的模糊只能采样到祖先内部，玻璃效果会失效。
        玻璃效果只加在面板自身。
      -->
      <div
        v-if="modelValue"
        class="g-modal__mask"
        :class="`g-modal__mask--${v}`"
        :style="{ zIndex }"
        @mousedown.self="maskDown = true"
        @mouseup.self="onMaskUp"
        @keydown="onKeydown"
      >
        <div
          ref="panel"
          class="g-modal__panel"
          :class="`glass-${v}`"
          :style="{ width }"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="title || $slots.header ? titleId : undefined"
          tabindex="-1"
        >
          <div v-if="title || $slots.header" :id="titleId" class="g-modal__header">
            <slot name="header">{{ title }}</slot>
          </div>
          <button
            v-if="showClose"
            type="button"
            class="g-modal__close"
            aria-label="关闭"
            @click="close"
          >
            <span aria-hidden="true">×</span>
          </button>
          <div class="g-modal__body"><slot /></div>
          <div v-if="$slots.footer" class="g-modal__footer"><slot name="footer" /></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/**
 * 毛玻璃对话框。v-model 控制显示，Teleport 到 body。
 * - role="dialog" + aria-modal，有标题时 aria-labelledby 指向标题
 * - Esc 关闭（closeOnEsc）、点遮罩关闭（closeOnClickMask），Tab 焦点限制在对话框内
 * - 打开时焦点进入（优先 [autofocus]，其次第一个可聚焦元素，最后是面板本身），关闭时还原到打开前的元素
 * - z-index 取 Element Plus 的全局计数，和 el-dialog / el-message 叠放顺序一致
 * 插槽：header（默认显示 title）/ default / footer。事件：update:modelValue、open、close。
 */
import { useZIndex } from 'element-plus';
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useGlassVariant, variantProp } from './useGlassVariant.js';

defineOptions({ name: 'GlassModal' });

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  variant: variantProp,
  title: { type: String, default: '' },
  width: { type: String, default: '480px' },
  closeOnEsc: { type: Boolean, default: true },
  closeOnClickMask: { type: Boolean, default: true },
  showClose: { type: Boolean, default: true },
  /** 打开时锁定 body 滚动 */
  lockScroll: { type: Boolean, default: true },
});
const emit = defineEmits(['update:modelValue', 'open', 'close']);

const v = useGlassVariant(props);
const titleId = `glass-modal-${useId()}`;
const panel = ref(null);
const zIndex = ref(2000);
const maskDown = ref(false);
const { nextZIndex } = useZIndex();

let restoreTo = null;
let prevOverflow = null;

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusables() {
  if (!panel.value) return [];
  return [...panel.value.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

function close() {
  emit('update:modelValue', false);
}

function onMaskUp() {
  if (maskDown.value && props.closeOnClickMask) close();
  maskDown.value = false;
}

function onKeydown(e) {
  if (e.key === 'Escape' && props.closeOnEsc) {
    e.stopPropagation();
    close();
    return;
  }
  if (e.key !== 'Tab') return;
  const list = focusables();
  if (!list.length) {
    e.preventDefault();
    panel.value?.focus();
    return;
  }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === panel.value)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

async function onOpen() {
  restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  zIndex.value = nextZIndex();
  if (props.lockScroll) {
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  await nextTick();
  const target = panel.value?.querySelector('[autofocus]') || focusables()[0] || panel.value;
  target?.focus();
  emit('open');
}

function onClose() {
  if (prevOverflow !== null) {
    document.body.style.overflow = prevOverflow;
    prevOverflow = null;
  }
  const el = restoreTo;
  restoreTo = null;
  if (el && el.isConnected) el.focus();
  emit('close');
}

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open) onOpen();
    else if (wasOpen) onClose();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (props.modelValue) onClose();
});
</script>

<style scoped>
.g-modal__mask {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  overflow-y: auto;
  background: var(--glass-c-light-mask);
}
.g-modal__mask--dark {
  background: var(--glass-c-dark-mask);
}
.g-modal__panel {
  --glass-u-bg: var(--glass-c-bg-strong);
  --glass-u-border: var(--glass-c-edge);
  --glass-u-blur: var(--glass-c-blur-strong);
  --glass-u-saturate: var(--glass-c-saturate);
  position: relative;
  box-sizing: border-box;
  max-width: 100%;
  margin: auto;
  padding: 20px;
  border-radius: 16px;
  color: var(--glass-u-text);
  box-shadow: var(--glass-shadow-pop);
  outline: none;
}
.g-modal__header {
  padding-right: 32px;
  margin-bottom: 14px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}
.g-modal__close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--glass-u-text-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.g-modal__close:hover {
  background: var(--glass-c-hover-fill);
  color: var(--glass-u-text);
}
.g-modal__close:focus-visible {
  outline: 2px solid var(--glass-c-focus);
  outline-offset: 2px;
}
.g-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

.g-modal-enter-active,
.g-modal-leave-active {
  transition: opacity 0.2s ease;
}
.g-modal-enter-active .g-modal__panel,
.g-modal-leave-active .g-modal__panel {
  transition: transform 0.2s ease;
}
.g-modal-enter-from,
.g-modal-leave-to {
  opacity: 0;
}
.g-modal-enter-from .g-modal__panel,
.g-modal-leave-to .g-modal__panel {
  transform: scale(0.97);
}
@media (prefers-reduced-motion: reduce) {
  .g-modal-enter-active,
  .g-modal-leave-active,
  .g-modal-enter-active .g-modal__panel,
  .g-modal-leave-active .g-modal__panel {
    transition: none;
  }
}
</style>
