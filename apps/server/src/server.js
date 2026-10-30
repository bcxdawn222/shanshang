import fs from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

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
