import fs from 'node:fs';
import path from 'node:path';
import { createApprovedMerchant } from './lib/accounts.js';
import { tryXmaxUpload } from './lib/garments.js';
import { detectImage } from './lib/images.js';
import { createLocalStorage } from './lib/storage.js';
import { randomPassword } from './lib/tokens.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

/**
 * 创建“平台演示商家”和 5 件测试服饰，用于联调和演示，上线前在总后台停用。
 * 可以重复执行：商家已存在不重建，同名服饰已存在不重复插入。
 * 演示服饰直接上架（不走审核期），原图转存 Xmax 失败不阻断，设备端用官方 SDK 兜底。
 */
const ASSETS_DIR = new URL('../seed-assets/garments/', import.meta.url);

// 品类只能从现有字典里选，没有“吊带”“马甲”，取最接近的；可在总后台改
const DEMO_GARMENTS = [
  { file: 'g1.jpg', title: '奶白毛领连帽收腰呢大衣', category: '外套', color: '米色', scenes: ['约会', '见家长', '旅行拍照'] },
  { file: 'g2.jpg', title: '棕色波点蝴蝶结吊带上衣', category: 'T恤', color: '棕色', scenes: ['约会', '闺蜜', '休闲'] },
  { file: 'g3.jpg', title: '白色荷叶领撞色滚边衬衫', category: '衬衫', color: '白色', scenes: ['通勤', '面试'] },
  { file: 'g4.jpg', title: '卡其双排扣蝴蝶结无袖收腰上衣', category: '西装', color: '米色', scenes: ['通勤', '约会'] },
  { file: 'g5.jpg', title: '黑色荷叶边下摆短款呢外套', category: '外套', color: '黑色', scenes: ['通勤', '宴会'] },
];

const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const db = openDb(config.dbFile);
const storage = createLocalStorage(path.join(config.dataDir, 'media'));
const ctx = { config, db, storage, fetchImpl: globalThis.fetch, now: Date.now };
const log = { warn: (obj, msg) => console.warn(`${msg}（${obj?.code ?? 'unknown'}）`) };

const username = process.env.SEED_DEMO_USERNAME || 'demo';
let merchantId = db.prepare("SELECT id FROM account WHERE username = ? AND role = 'merchant'").pluck().get(username);
if (merchantId) {
  console.log(`演示商家 ${username} 已存在，跳过创建`);
} else if (db.prepare('SELECT 1 FROM account WHERE username = ?').get(username)) {
  throw new Error(`用户名 ${username} 已被非商家账号占用`);
} else {
  const password = process.env.SEED_DEMO_PASSWORD || randomPassword(14);
  merchantId = await createApprovedMerchant(db, {
    username,
    password,
    brandName: '平台演示商家',
    note: '演示账号，上线前停用',
    now: Date.now,
  });
  console.log(`已创建演示商家 ${username}`);
  if (!process.env.SEED_DEMO_PASSWORD) console.log(`随机密码（只显示这一次）：${password}`);
}

const dictId = (kind, name) => {
  const id = db.prepare('SELECT id FROM dict_item WHERE kind = ? AND name = ?').pluck().get(kind, name);
  if (!id) throw new Error(`字典缺少 ${kind}：${name}`);
  return id;
};
const exists = db.prepare('SELECT 1 FROM garment WHERE merchant_id = ? AND title = ? AND deleted_at IS NULL');
const insert = db.prepare(
  `INSERT INTO garment (merchant_id, title, gender, set_type, category_id, color_id, scene_ids, discount_text,
                        shop_location, image_key, xmax_url, status, available_at, created_at, updated_at)
   VALUES (?, ?, 'female', 'single', ?, ?, ?, '', '', ?, ?, 'ready', ?, ?, ?)`,
);

let added = 0;
for (const g of DEMO_GARMENTS) {
  if (exists.get(merchantId, g.title)) continue;
  const buffer = fs.readFileSync(new URL(g.file, ASSETS_DIR));
  const image = detectImage(buffer);
  if (!image) throw new Error(`${g.file} 不是 JPG/PNG/WebP`);
  const categoryId = dictId('category', g.category);
  const colorId = dictId('color', g.color);
  const sceneIds = g.scenes.map((s) => dictId('scene', s));

  const imageKey = await storage.put('garments', buffer, image.ext);
  const xmaxUrl = await tryXmaxUpload(ctx, buffer, image.mime, log);
  const t = Date.now();
  insert.run(merchantId, g.title, categoryId, colorId, JSON.stringify(sceneIds), imageKey, xmaxUrl, t, t, t);
  added += 1;
  console.log(`已添加服饰「${g.title}」${xmaxUrl ? '' : '（未转存 Xmax）'}`);
}
console.log(added ? `演示服饰新增 ${added} 件` : '演示服饰已齐全，跳过');
db.close();
