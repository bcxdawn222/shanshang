import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// 线上挂在 nginx 的 /sl/admin/ 下，接口在 /sl/api/；开发时 /api 代理到本机服务端
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.ADMIN_BASE || '/sl/admin/' : '/',
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    proxy: { '/api': 'http://127.0.0.1:8300' },
  },
}));
