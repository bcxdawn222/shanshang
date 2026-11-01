import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { purgeExpiredSnapshots } from './lib/snapshots.js';
import { createLocalStorage } from './lib/storage.js';

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbFile);
const app = await buildApp({ config, db, logger: true });

const hasAdmin = db.prepare("SELECT 1 FROM account WHERE role = 'admin'").get();
if (!hasAdmin) app.log.warn('还没有超级管理员：请设置 ADMIN_USERNAME / ADMIN_PASSWORD 后重启');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });

// 每小时清理一次过期快照图片（buildApp 里不起定时器，测试不会挂住）
const purgeCtx = { db, storage: createLocalStorage(path.join(config.dataDir, 'media')), now: Date.now };
const purge = () =>
  purgeExpiredSnapshots(purgeCtx)
    .then(({ purged }) => purged && app.log.info({ purged }, 'expired snapshots purged'))
    .catch((error) => app.log.error(error, 'purge snapshots failed'));
purge();
setInterval(purge, 3600_000).unref();
