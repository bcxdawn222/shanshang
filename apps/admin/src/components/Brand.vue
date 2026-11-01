<template>
  <div class="brand">
    <!-- 未配置 logoUrl 时用定稿的 B 版图标（ACC-05，design/logo/logo-b-icon.svg） -->
    <img :src="store.settings.logoUrl || DEFAULT_LOGO" alt="" class="logo" />
    <span class="name">{{ store.settings.platformName }}</span>
  </div>
</template>

<script setup>
import { store } from '../store.js';

const DEFAULT_LOGO = `${import.meta.env.BASE_URL}favicon.svg`;
</script>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  width: 32px;
  height: 32px;
  object-fit: contain;
}
.name {
  font-weight: 600;
  font-size: 18px;
  letter-spacing: 1px;
}
</style>
