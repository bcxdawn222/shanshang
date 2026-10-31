<template>
  <!-- 登录 / 注册页外框；背景图由总后台配置（ACC-04），未配置时用渐变占位 -->
  <div class="auth" :style="bgStyle">
    <!-- 背景图任意深浅都要可读，所以用 strong（更不透明、模糊更强） -->
    <GlassCard strong class="card">
      <Brand class="head" />
      <h1>{{ title }}</h1>
      <slot />
    </GlassCard>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { store } from '../store.js';
import Brand from './Brand.vue';
import { GlassCard } from './glass/index.js';

defineProps({ title: { type: String, required: true } });

const bgStyle = computed(() =>
  store.settings.loginBgUrl
    ? { backgroundImage: `url("${encodeURI(store.settings.loginBgUrl)}")` }
    : { backgroundImage: 'var(--glass-auth-bg)' },
);
</script>

<style scoped>
.auth {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--glass-page-color);
  background-size: cover;
  background-position: center;
  padding: 24px;
  box-sizing: border-box;
}
/* 居中毛玻璃卡片：玻璃面 / 阴影由 GlassCard 负责，这里只定尺寸和圆角 */
.card {
  --glass-card-padding: 32px 30px 22px;
  --glass-card-radius: 20px;
  width: 100%;
  max-width: 380px;
}
.head {
  justify-content: center;
}
h1 {
  font-size: 17px;
  font-weight: 600;
  text-align: center;
  color: var(--el-text-color-primary);
  margin: 14px 0 22px;
}
</style>
