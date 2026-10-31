<template>
  <div class="g-card" :class="[`glass-${v}`, { 'g-card--strong': strong }]">
    <div v-if="$slots.header" class="g-card__header"><slot name="header" /></div>
    <div class="g-card__body"><slot /></div>
    <div v-if="$slots.footer" class="g-card__footer"><slot name="footer" /></div>
  </div>
</template>

<script setup>
/**
 * 毛玻璃卡片。插槽：header / default / footer。
 * 可调：--glass-card-padding（默认 20px）、--glass-card-radius（默认 16px）；
 * 想要悬停加深，在使用处加 class="glass-hover"。
 */
import { useGlassVariant, variantProp } from './useGlassVariant.js';

defineOptions({ name: 'GlassCard' });

const props = defineProps({
  variant: variantProp,
  /** 更不透明、模糊更强：放在任意背景图上（如登录页）时用，保证可读 */
  strong: { type: Boolean, default: false },
});
const v = useGlassVariant(props);
</script>

<style scoped>
.g-card {
  --glass-u-bg: var(--glass-c-bg);
  --glass-u-bg-hover: var(--glass-c-bg-hover);
  --glass-u-border: var(--glass-c-border);
  --glass-u-blur: var(--glass-c-blur);
  --glass-u-saturate: var(--glass-c-saturate);
  box-sizing: border-box;
  padding: var(--glass-card-padding, 20px);
  border-radius: var(--glass-card-radius, 16px);
  color: var(--glass-u-text);
  box-shadow: var(--glass-shadow);
}
.g-card--strong {
  --glass-u-bg: var(--glass-c-bg-strong);
  --glass-u-blur: var(--glass-c-blur-strong);
  box-shadow: var(--glass-shadow-pop);
}
.g-card__header {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--glass-c-hairline);
  font-size: 15px;
  font-weight: 600;
}
.g-card__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--glass-c-hairline);
}
</style>
