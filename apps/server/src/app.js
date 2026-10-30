import path from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { ensureAdmin } from './lib/accounts.js';
import { errorHandler } from './lib/http.js';
import { FailureLimiter, WindowLimiter } from './lib/limiter.js';
import { SESSION_COOKIE, loadSession } from './lib/session.js';
import { createLocalStorage } from './lib/storage.js';
import adminRoutes from './routes/admin.js';
import adminGarmentRoutes from './routes/adminGarments.js';
import authRoutes from './routes/auth.js';
import deviceRoutes from './routes/device.js';
import mediaRoutes from './routes/media.js';
import merchantRoutes from './routes/merchant.js';
import merchantGarmentRoutes from './routes/merchantGarments.js';
import publicRoutes from './routes/public.js';

// 服饰图单张上限
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * 组装应用。db、fetch、时钟都从外面注入，测试时用内存库、假 Xmax 和可拨动的时钟。
 * 所有接口挂在 /api 下；nginx 的 /sl/ 前缀在反代时去掉。
 */
export async function buildApp({ config, db, storage, fetchImpl = globalThis.fetch, now = Date.now, logger = false }) {
  // removeAdditional=false：多余字段直接 400，而不是被悄悄删掉（例如商家试图改品牌名）
  const app = Fastify({
    logger,
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(cookie);
  // bodyLimit 只管 JSON，multipart 单独限：一个文件、10MB、字段数量有限
  await app.register(multipart, { limits: { files: 1, fileSize: MAX_IMAGE_BYTES, fields: 20, fieldSize: 4096 } });

  const ctx = {
    config,
    db,
    storage: storage ?? createLocalStorage(path.join(config.dataDir, 'media')),
    fetchImpl,
    now,
    limiters: {
      login: new FailureLimiter({ maxFailures: 5, lockMs: 15 * 60_000, now }),
      register: new WindowLimiter({ limit: 10, windowMs: 60 * 60_000, now }),
      deviceRegister: new WindowLimiter({ limit: 10, windowMs: 60 * 60_000, now }),
      xmaxKey: new WindowLimiter({ limit: 30, windowMs: 60 * 60_000, now }),
    },
  };

  app.decorateRequest('account', null);
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('device', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    const session = loadSession(db, token, now());
    if (session) {
      request.account = session.account;
      request.sessionToken = token;
    }
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } }),
  );

  await ensureAdmin(db, config, now);

  for (const routes of [
    publicRoutes,
    mediaRoutes,
    authRoutes,
    merchantRoutes,
    merchantGarmentRoutes,
    adminRoutes,
    adminGarmentRoutes,
    deviceRoutes,
  ]) {
    await app.register(routes, { prefix: '/api', ctx });
  }
  return app;
}
