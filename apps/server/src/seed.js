import fs from 'node:fs';
import { createApprovedMerchant } from './lib/accounts.js';
import { randomPassword } from './lib/tokens.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

/**
 * 创建“平台演示商家”，用于联调和演示，上线前在总后台停用。
 * 5 件测试服饰在 Phase 2（服饰表落地后）补进种子。
 */
const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbFile);

const username = process.env.SEED_DEMO_USERNAME || 'demo';
if (db.prepare('SELECT 1 FROM account WHERE username = ?').get(username)) {
  console.log(`演示商家 ${username} 已存在，跳过`);
} else {
  const password = process.env.SEED_DEMO_PASSWORD || randomPassword(14);
  await createApprovedMerchant(db, {
    username,
    password,
    brandName: '平台演示商家',
    note: '演示账号，上线前停用',
    now: Date.now,
  });
  console.log(`已创建演示商家 ${username}`);
  if (!process.env.SEED_DEMO_PASSWORD) console.log(`随机密码（只显示这一次）：${password}`);
}
db.close();
