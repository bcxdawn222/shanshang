import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db.js';
import { UPLOAD_WINDOW_MS, publicState } from '../src/lib/snapshots.js';
import { STATE_SQL } from '../src/routes/adminSnapshots.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.UTC(2026, 9, 31, 8, 0, 0);

// 简单可复现的伪随机，失败时能按 seed 复现
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * 对拍：随机造各种时间 / 状态组合，断言 publicState() 与 STATE_SQL 四个口径一致，
 * 且四个 SQL 条件两两互斥、合起来覆盖全集。以后改了一边忘另一边会在这里失败。
 */
test('快照状态：publicState() 与 STATE_SQL 互斥、覆盖全集且一一对应', () => {
  const db = openDb(':memory:');
  db.pragma('foreign_keys = OFF'); // 只测状态口径，不造服饰 / 商家
  const rnd = lcg(20261031);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  // 围绕各个边界取值：上传窗口、7 天有效期，各取正好、前一毫秒、后一毫秒
  const createdOffsets = [0, -1, -UPLOAD_WINDOW_MS + 1, -UPLOAD_WINDOW_MS, -UPLOAD_WINDOW_MS - 1, -3 * DAY, -7 * DAY + 1, -7 * DAY, -8 * DAY];
  const insert = db.prepare(
    `INSERT INTO snapshot (token, code, garment_id, merchant_id, image_key, created_at, expires_at, redeemed_at, purged_at)
     VALUES (@token, '000000', 1, 1, @imageKey, @createdAt, @expiresAt, @redeemedAt, @purgedAt)`,
  );
  const rows = [];
  for (let i = 0; i < 200; i += 1) {
    const createdAt = NOW + pick(createdOffsets);
    const row = {
      token: `t${i}`,
      imageKey: rnd() < 0.6 ? `snapshots/${i}.jpg` : null,
      createdAt,
      expiresAt: createdAt + 7 * DAY + pick([0, 0, 0, -1, 1]),
      redeemedAt: rnd() < 0.25 ? createdAt + MIN : null,
      purgedAt: rnd() < 0.15 ? createdAt + 7 * DAY : null,
    };
    row.id = Number(insert.run(row).lastInsertRowid);
    rows.push(row);
  }

  const params = { now: NOW, voidBefore: NOW - UPLOAD_WINDOW_MS };
  const idsBySql = Object.fromEntries(
    Object.entries(STATE_SQL).map(([state, sql]) => [
      state,
      new Set(db.prepare(`SELECT s.id FROM snapshot s WHERE ${sql}`).pluck().all(params)),
    ]),
  );
  assert.deepEqual(Object.keys(STATE_SQL).sort(), ['expired', 'pending', 'redeemed', 'valid']);

  const seen = new Set();
  for (const r of rows) {
    const state = publicState(
      { image_key: r.imageKey, created_at: r.createdAt, expires_at: r.expiresAt, redeemed_at: r.redeemedAt, purged_at: r.purgedAt },
      NOW,
    );
    seen.add(state);
    const hits = Object.keys(idsBySql).filter((k) => idsBySql[k].has(r.id));
    assert.deepEqual(hits, [state], `快照 #${r.id} ${JSON.stringify(r)}：publicState=${state}，SQL 命中 ${hits.join(',') || '无'}`);
  }
  // 随机数据要真的覆盖到四种状态，否则对拍没意义
  assert.deepEqual([...seen].sort(), ['expired', 'pending', 'redeemed', 'valid']);
  db.close();
});
