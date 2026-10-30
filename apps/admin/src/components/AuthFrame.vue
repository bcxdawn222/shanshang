<template>
  <!-- 登录 / 注册页外框；背景图由总后台配置（ACC-04），未配置时用渐变占位 -->
  <div class="auth" :style="bgStyle">
    <div class="card">
      <Brand class="head" />
      <h1>{{ title }}</h1>
      <slot />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { store } from '../store.js';
import Brand from './Brand.vue';

defineProps({ title: { type: String, required: true } });

const bgStyle = computed(() =>
  store.settings.loginBgUrl
    ? { backgroundImage: `url("${encodeURI(store.settings.loginBgUrl)}")` }
    : { backgroundImage: 'linear-gradient(135deg, #1b1035 0%, #3a1c71 45%, #0f4c75 100%)' },
);
</script>

<style scoped>
.auth {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: cover;
  background-position: center;
  padding: 24px;
  box-sizing: border-box;
}
.card {
  width: 100%;
  max-width: 380px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 12px;
  padding: 28px 28px 20px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}
.head {
  justify-content: center;
}
h1 {
  font-size: 16px;
  font-weight: 500;
  text-align: center;
  color: #555;
  margin: 12px 0 20px;
}
</style>
