import { getSettings } from '../lib/settings.js';

export default async function publicRoutes(app, { ctx }) {
  const { db, config, now } = ctx;

  app.get('/health', async () => ({
    ok: true,
    xmaxKeyConfigured: Boolean(config.xmax.apiKey && config.xmax.apiBase),
    now: new Date(now()).toISOString(),
  }));

  // 登录页、设备前台读取平台名、Logo、登录背景
  app.get('/settings/public', async () => getSettings(db));
}
