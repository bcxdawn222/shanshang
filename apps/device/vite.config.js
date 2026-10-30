import { defineConfig } from 'vite';

// 线上挂在 nginx 的 /sl/device/ 下，接口在 /sl/api/；开发时 /api 代理到本机服务端
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.DEVICE_BASE || '/sl/device/' : '/',
  server: {
    host: '127.0.0.1',
    port: 5190,
    proxy: { '/api': 'http://127.0.0.1:8300' },
  },
}));
