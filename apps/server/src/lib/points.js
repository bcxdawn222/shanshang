import { HttpError } from './http.js';

/**
 * 积分账本（PT-01~06）。金额一律用毫积分整数（1 积分 = 1000）存储和计算，避免浮点误差；
 * 只在接口出口换算成积分。merchant.balance_milli 是快照，和流水在同一事务里更新。
 */
export const MILLI = 1000;
export const LEDGER_TYPES = ['ADMIN_ADD', 'ADMIN_DEDUCT', 'TRYON_CONSUME', 'REFUND'];

const CONFIG_MAP = {
  pointsPerMinute: { key: 'points_per_minute', number: true, fallback: 1 },
  hideThreshold: { key: 'hide_threshold', number: true, fallback: 5 },
  xmaxRatio: { key: 'xmax_ratio', fallback: '' },
  rechargeContact: { key: 'recharge_contact', fallback: '' },
  rechargeQrUrl: { key: 'recharge_qr_url', fallback: '' },
  tryonMaxMinutes: { key: 'tryon_max_minutes', number: true, fallback: 5 },
};

/**
 * 毫积分 → 积分（保留 2 位小数的数字）。先在整数上四舍五入到 10 毫积分再除，
 * 避免 toFixed 的浮点误差（99.225 → 99.22）；负数按绝对值舍入，正负对称
 */
export const toPoints = (milli) => (Math.sign(milli) * Math.round(Math.abs(milli) / 10)) / 100 || 0;
export const toMilli = (points) => Math.round(points * MILLI);

/** 扣费：cost_milli = round(duration_ms * pointsPerMinute * 1000 / 60000)，按秒累计 */
export function costMilli(durationMs, pointsPerMinute) {
  return Math.round((durationMs * pointsPerMinute * MILLI) / 60_000);
}

/** 余额低于阈值的商家，其服饰不进设备清单 */
export function isHidden(balanceMilli, config) {
  return balanceMilli < toMilli(config.hideThreshold);
}

export function getPointsConfig(db) {
  const stmt = db.prepare('SELECT value FROM setting WHERE key = ?').pluck();
  const out = {};
  for (const [field, def] of Object.entries(CONFIG_MAP)) {
    const raw = stmt.get(def.key);
    if (def.number) {
      const n = Number(raw);
      out[field] = raw !== undefined && raw !== '' && Number.isFinite(n) ? n : def.fallback;
    } else {
      out[field] = raw ?? def.fallback;
    }
  }
  return out;
}

/** 只更新传入的字段，返回实际改动的字段名 */
export function updatePointsConfig(db, patch, now) {
  const changed = [];
  const stmt = db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  db.transaction(() => {
    for (const [field, def] of Object.entries(CONFIG_MAP)) {
      if (patch[field] === undefined) continue;
      stmt.run(def.key, String(patch[field]), now);
      changed.push(field);
    }
  })();
  return changed;
}

/**
 * 记一笔账：更新余额快照并追加流水，返回记账后的余额（毫积分）。
 * 在调用方的事务里调用时会成为 savepoint，和审计等写入一起提交。
 */
export function appendEntry(
  db,
  { merchantId, type, amountMilli, garmentId = null, deviceId = null, sessionId = null, seq = null, durationMs = null, note = '', actorId = null, now },
) {
  return db.transaction(() => {
    const balance = db
      .prepare('UPDATE merchant SET balance_milli = balance_milli + ? WHERE account_id = ? RETURNING balance_milli')
      .pluck()
      .get(amountMilli, merchantId);
    if (balance === undefined) throw new HttpError(404, 'MERCHANT_NOT_FOUND', '商家不存在');
    db.prepare(
      `INSERT INTO point_ledger (merchant_id, type, amount_milli, balance_after_milli, garment_id, device_id,
                                 session_id, seq, duration_ms, note, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(merchantId, type, amountMilli, balance, garmentId, deviceId, sessionId, seq, durationMs, note, actorId, now);
    return balance;
  })();
}

/**
 * 设备上报离屏时长，即时扣到服饰所属商家，允许透支为负。
 * 幂等键 device_id + session_id + seq：已记过的计入 duplicates；服饰不存在（含已删除）计入 skipped。
 */
export function consumeSegments(db, { deviceId, sessionId, segments, now }) {
  const { pointsPerMinute } = getPointsConfig(db);
  const seen = db.prepare('SELECT 1 FROM point_ledger WHERE device_id = ? AND session_id = ? AND seq = ?');
  const findGarment = db.prepare('SELECT id, merchant_id FROM garment WHERE id = ? AND deleted_at IS NULL');
  return db.transaction(() => {
    const result = { accepted: 0, duplicates: 0, skipped: 0 };
    for (const s of segments) {
      if (seen.get(deviceId, sessionId, s.seq)) {
        result.duplicates += 1;
        continue;
      }
      const g = findGarment.get(s.garmentId);
      if (!g) {
        result.skipped += 1;
        continue;
      }
      appendEntry(db, {
        merchantId: g.merchant_id,
        type: 'TRYON_CONSUME',
        amountMilli: 0 - costMilli(s.durationMs, pointsPerMinute),
        garmentId: g.id,
        deviceId,
        sessionId,
        seq: s.seq,
        durationMs: s.durationMs,
        now,
      });
      result.accepted += 1;
    }
    return result;
  })();
}

/** 账号使用总时长 = 本商家所有 TRYON_CONSUME 的在屏时长之和，与扣费同口径 */
export function usageMs(db, merchantId) {
  return db
    .prepare("SELECT COALESCE(SUM(duration_ms), 0) FROM point_ledger WHERE merchant_id = ? AND type = 'TRYON_CONSUME'")
    .pluck()
    .get(merchantId);
}

/** 商家自己看的积分概况（不含 xmaxRatio） */
export function merchantPoints(db, merchantId) {
  const config = getPointsConfig(db);
  const balanceMilli = db.prepare('SELECT balance_milli FROM merchant WHERE account_id = ?').pluck().get(merchantId) ?? 0;
  return {
    balance: toPoints(balanceMilli),
    balanceMilli,
    usageMs: usageMs(db, merchantId),
    hideThreshold: config.hideThreshold,
    hidden: isHidden(balanceMilli, config),
  };
}

function ledgerView(r) {
  return {
    id: r.id,
    merchantId: r.merchant_id,
    brandName: r.brand_name,
    type: r.type,
    amount: toPoints(r.amount_milli),
    amountMilli: r.amount_milli,
    balanceAfter: toPoints(r.balance_after_milli),
    garmentId: r.garment_id,
    garmentTitle: r.garment_title ?? null,
    deviceId: r.device_id,
    durationMs: r.duration_ms,
    note: r.note,
    createdAt: r.created_at,
  };
}

/** 分页查流水，新的在前 */
export function queryLedger(db, { merchantId = null, type = null, page = 1, pageSize = 20 }) {
  const where = '(? IS NULL OR l.merchant_id = ?) AND (? IS NULL OR l.type = ?)';
  const args = [merchantId, merchantId, type, type];
  const total = db.prepare(`SELECT COUNT(*) FROM point_ledger l WHERE ${where}`).pluck().get(...args);
  const rows = db
    .prepare(
      `SELECT l.*, m.brand_name, g.title AS garment_title
         FROM point_ledger l
         JOIN merchant m ON m.account_id = l.merchant_id
         LEFT JOIN garment g ON g.id = l.garment_id
        WHERE ${where}
        ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize);
  return { items: rows.map(ledgerView), total };
}
