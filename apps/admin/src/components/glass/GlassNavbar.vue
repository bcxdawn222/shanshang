<template>
  <component :is="tag" class="g-nav" :class="`glass-${v}`">
    <div class="g-nav__brand"><slot name="brand" /></div>
    <div class="g-nav__center"><slot /></div>
    <div class="g-nav__right"><slot name="right" /></div>
  </component>
</template>

<script setup>
/**
 * 毛玻璃顶栏，position: sticky 吸顶。插槽：brand（左）/ default（中，占满剩余宽度）/ right（右）。
 * 可调：--glass-navbar-height（默认 56px）、--glass-navbar-padding（默认 0 20px）。
 * 注意：本元素有 backdrop-filter，不要把 el-dialog 等 fixed 元素放进它的插槽（见 glass.css 顶部注释）。
 */
import { useGlassVariant, variantProp } from './useGlassVariant.js';

defineOptions({ name: 'GlassNavbar' });

const props = defineProps({
  variant: variantProp,
  /** 根元素标签；页面级顶栏用 header，内嵌导航可用 nav */
  tag: { type: String, default: 'header' },
});
const v = useGlassVariant(props);
</script>

<style scoped>
.g-nav {
  --glass-u-bg: var(--glass-c-bg);
  --glass-u-blur: var(--glass-c-blur);
  --glass-u-saturate: var(--glass-c-saturate);
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 16px;
  box-sizing: border-box;
  height: var(--glass-navbar-height, 56px);
  padding: var(--glass-navbar-padding, 0 20px);
  /* 顶栏只要底边一条细线 */
  border-width: 0 0 1px;
  border-color: var(--glass-c-edge);
  color: var(--glass-u-text);
}
.g-nav__brand,
.g-nav__right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 12px;
}
.g-nav__center {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 12px;
}
.g-nav__brand:empty,
.g-nav__right:empty {
  display: none;
}
</style>
