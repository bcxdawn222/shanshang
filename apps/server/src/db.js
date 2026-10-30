import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** 打开数据库并执行未应用的迁移；file 传 ':memory:' 用于测试 */
export function openDb(file = ':memory:') {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/** 按文件名顺序执行 migrations/*.sql，每个文件一个事务，只执行一次 */
export function migrate(db) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migration (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const applied = new Set(db.prepare('SELECT name FROM schema_migration').pluck().all());
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migration (name, applied_at) VALUES (?, ?)').run(name, Date.now());
    })();
  }
}
