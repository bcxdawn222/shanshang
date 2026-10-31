import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 玩法共用纯逻辑直接引用 packages/shared 源码（零依赖 ESM），不走 npm 包
const deviceRoot = fileURLToPath(new URL('.', import.meta.url));
const sharedSrc = fileURLToPath(new URL('../../packages/shared/src', import.meta.url));

// 线上挂在 nginx 的 /sl/device/ 下，接口在 /sl/api/；开发时 /api 代理到本机服务端
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.DEVICE_BASE || '/sl/device/' : '/',
  resolve: {
    alias: { '@shanshang/shared': `${sharedSrc}/index.js` },
  },
  server: {
    host: '127.0.0.1',
    port: 5190,
    proxy: { '/api': 'http://127.0.0.1:8300' },
    fs: { allow: [deviceRoot, sharedSrc] },
  },
}));
