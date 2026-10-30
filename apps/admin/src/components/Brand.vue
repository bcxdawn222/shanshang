<template>
  <div class="brand">
    <img v-if="store.settings.logoUrl" :src="store.settings.logoUrl" alt="" class="logo" />
    <!-- Logo 定稿前的占位标识（ACC-05，Phase 7 出 3 版供选） -->
    <svg v-else class="logo" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="slg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff3d9a" />
          <stop offset="1" stop-color="#3dd6ff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#slg)" />
      <path d="M19 9l-8 8h5l-3 6 8-8h-5z" fill="#fff" />
    </svg>
    <span class="name">{{ store.settings.platformName }}</span>
  </div>
</template>

<script setup>
import { store } from '../store.js';
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
