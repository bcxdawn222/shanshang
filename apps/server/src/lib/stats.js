import { HttpError } from './http.js';

/**
 * 数据统计（STA-01~03）。口径见 docs/02-业务设计/数据统计埋点.md：
 * 设备上报的明细先写 event 表（按 device_id + session_id + seq 去重），同一事务里累加到 stat_daily；
 * 报表和导出只读 stat_daily。日期一律按北京时间（UTC+8，无夏令时）。
 */
export const EVENT_TYPES = ['brand_click', 'brand_dwell', 'tryon_start', 'tryon_end', 'ai_recommend', 'snapshot_create'];
// 品牌停留单次上限 10 分钟
export const MAX_DWELL_MS = 10 * 60_000;
// 试穿时长单次上限 10 分钟，与 /device/tryon/segments 的单段上限一致
export const MAX_TRYON_MS = 10 * 60_000;
// 同一会话同一服饰 30 秒内重复出画面不重计
export const TRYON_DEDUP_MS = 30_000;
// 报表日期范围最多 366 天（含首尾）
export const MAX_RANGE_DAYS = 366;
// 默认查询近 30 天
export const DEFAULT_RANGE_DAYS = 30;

// 设备时钟不可信：比服务端快 5 分钟以上、或早于 7 天前（断网补报上限）的 ts 改用服务端收到的时间
const FUTURE_SKEW_MS = 5 * 60_000;
const PAST_WINDOW_MS = 7 * 24 * 3600_000;
const TZ_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 24 * 3600_000;

// 接口字段 → stat_daily 列
export const METRICS = [
  ['brandClicks', 'brand_clicks'],
  ['brandDwellMs', 'brand_dwell_ms'],
  ['tryonCount', 'tryon_count'],
  ['tryonMs', 'tryon_ms'],
  ['redeemCount', 'redeem_count'],
  ['recommendCount', 'recommend_count'],
];

/** 毫秒时间戳 → 北京时间日期 YYYY-MM-DD */
export function shanghaiDay(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD → 当天 00:00 UTC 的毫秒数（只用于日期加减）；不是合法日期返回 null */
function parseDay(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const ms = Date.parse(`${str}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== str) return null;
  return ms;
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * 解析报表日期范围：都不传为近 30 天（截止今天）；只传 to 往前推 30 天；只传 from 截止今天。
 * 返回 { from, to, days }，非法日期、from > to、超过 366 天一律 400。
 */
export function resolveRange({ from, to } = {}, nowMs) {
  const end = to ?? shanghaiDay(nowMs);
  const e = parseDay(end);
  if (e == null) throw new HttpError(400, 'BAD_REQUEST', '日期格式不正确，应为 YYYY-MM-DD');
  const start = from ?? dayOf(e - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
  const s = parseDay(start);
  if (s == null) throw new HttpError(400, 'BAD_REQUEST', '日期格式不正确，应为 YYYY-MM-DD');
  if (s > e) throw new HttpError(400, 'BAD_REQUEST', '开始日期不能晚于结束日期');
  const days = Math.round((e - s) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) throw new HttpError(400, 'RANGE_TOO_LARGE', `日期范围最多 ${MAX_RANGE_DAYS} 天`);
  return { from: start, to: end, days };
}

const UPSERT_SQL = `INSERT INTO stat_daily (day, merchant_id, garment_id, device_id, ${METRICS.map(([, c]) => c).join(', ')})
  VALUES (@day, @merchantId, @garmentId, @deviceId, ${METRICS.map(([f]) => `@${f}`).join(', ')})
  ON CONFLICT (day, merchant_id, garment_id, device_id) DO UPDATE SET
  ${METRICS.map(([, c]) => `${c} = ${c} + excluded.${c}`).join(',\n  ')}`;

/** 累加一行日汇总；garmentId = 0 为品牌级，deviceId = 0 为无设备归属 */
export function addStat(db, { day, merchantId, garmentId = 0, deviceId = 0, ...delta }) {
  const row = { day, merchantId, garmentId: garmentId ?? 0, deviceId: deviceId ?? 0 };
  for (const [f] of METRICS) row[f] = delta[f] ?? 0;
  db.prepare(UPSERT_SQL).run(row);
}

/** 核销成功（服务端产生的 redeem 事件）：计入核销当天、服饰所属商家、快照来源设备 */
export function recordRedeem(db, { merchantId, garmentId, deviceId, now }) {
  addStat(db, { day: shanghaiDay(now), merchantId, garmentId, deviceId: deviceId ?? 0, redeemCount: 1 });
}

function normalizeTs(ts, now) {
  if (!Number.isFinite(ts) || ts > now + FUTURE_SKEW_MS || ts < now - PAST_WINDOW_MS) return now;
  return ts;
}

/**
 * 设备批量上报埋点。重复（同 device + session + seq）计入 duplicates；
 * 缺少该类型必需字段、商家 / 服饰不存在的计入 skipped（不入库，整批不报错，免得设备队列卡死）。
 * merchant_id 一律由服务端确定：服饰事件取服饰所属商家，品牌事件取上报的 merchantId 并校验存在。
 */
export function ingestEvents(db, { deviceId, sessionId, events, now }) {
  const seen = db.prepare('SELECT 1 FROM event WHERE device_id = ? AND session_id = ? AND seq = ?');
  const findGarment = db.prepare('SELECT id, merchant_id FROM garment WHERE id = ?');
  const merchantExists = db.prepare('SELECT 1 FROM merchant WHERE account_id = ?');
  const recentStart = db.prepare(
    `SELECT 1 FROM event
      WHERE type = 'tryon_start' AND device_id = ? AND session_id = ? AND garment_id = ? AND counted = 1
        AND ts > ? AND ts < ? LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO event (device_id, session_id, seq, type, ts, day, merchant_id, garment_id, garment_ids,
                        snapshot_id, duration_ms, question_key, counted, created_at)
     VALUES (@deviceId, @sessionId, @seq, @type, @ts, @day, @merchantId, @garmentId, @garmentIds,
             @snapshotId, @durationMs, @questionKey, @counted, @createdAt)`,
  );

  return db.transaction(() => {
    const result = { accepted: 0, duplicates: 0, skipped: 0 };
    for (const e of events) {
      if (seen.get(deviceId, sessionId, e.seq)) {
        result.duplicates += 1;
        continue;
      }
      const ts = normalizeTs(e.ts, now);
      const day = shanghaiDay(ts);
      const row = {
        deviceId,
        sessionId,
        seq: e.seq,
        type: e.type,
        ts,
        day,
        merchantId: null,
        garmentId: null,
        garmentIds: null,
        snapshotId: e.snapshotId ?? null,
        durationMs: e.durationMs ?? null,
        questionKey: e.questionKey ?? null,
        counted: 1,
        createdAt: now,
      };
      // 入库后要累加的汇总行
      const stats = [];
      const base = { day, deviceId };
      let ok = true;

      switch (e.type) {
        case 'brand_click':
        case 'brand_dwell': {
          if (!e.merchantId || !merchantExists.get(e.merchantId)) ok = false;
          else if (e.type === 'brand_dwell' && e.durationMs == null) ok = false;
          else {
            row.merchantId = e.merchantId;
            stats.push(
              e.type === 'brand_click'
                ? { ...base, merchantId: e.merchantId, brandClicks: 1 }
                : { ...base, merchantId: e.merchantId, brandDwellMs: Math.min(e.durationMs, MAX_DWELL_MS) },
            );
          }
          break;
        }
        case 'tryon_start':
        case 'tryon_end': {
          const g = e.garmentId ? findGarment.get(e.garmentId) : null;
          if (!g || (e.type === 'tryon_end' && e.durationMs == null)) {
            ok = false;
            break;
          }
          row.merchantId = g.merchant_id;
          row.garmentId = g.id;
          const key = { ...base, merchantId: g.merchant_id, garmentId: g.id };
          if (e.type === 'tryon_end') {
            // 只计时长，不扣费（扣费由 /device/tryon/segments 负责）
            stats.push({ ...key, tryonMs: Math.min(e.durationMs, MAX_TRYON_MS) });
          } else if (recentStart.get(deviceId, sessionId, g.id, ts - TRYON_DEDUP_MS, ts + TRYON_DEDUP_MS)) {
            row.counted = 0;
          } else {
            stats.push({ ...key, tryonCount: 1 });
          }
          break;
        }
        case 'ai_recommend': {
          const ids = [...new Set(e.garmentIds ?? [])];
          const found = ids.map((id) => findGarment.get(id)).filter(Boolean);
          if (!found.length) {
            ok = false;
            break;
          }
          row.garmentIds = JSON.stringify(found.map((g) => g.id));
          for (const g of found) stats.push({ ...base, merchantId: g.merchant_id, garmentId: g.id, recommendCount: 1 });
          break;
        }
        case 'snapshot_create': {
          // 没有对应报表指标，只留明细
          const g = e.garmentId ? findGarment.get(e.garmentId) : null;
          if (g) {
            row.merchantId = g.merchant_id;
            row.garmentId = g.id;
          }
          row.counted = 0;
          break;
        }
        default:
          ok = false;
      }

      if (!ok) {
        result.skipped += 1;
        continue;
      }
      insert.run(row);
      for (const s of stats) addStat(db, s);
      result.accepted += 1;
    }
    return result;
  })();
}

const SUMS = METRICS.map(([f, c]) => `COALESCE(SUM(s.${c}), 0) AS ${f}`).join(', ');
const pickMetrics = (r) => Object.fromEntries(METRICS.map(([f]) => [f, r?.[f] ?? 0]));

/**
 * 报表：{ range, totals, daily, byGarment[, byMerchant] }。
 * daily 覆盖范围内每一天（没有数据的天补 0）；byGarment 只含服饰级数据（不含品牌点击 / 停留）。
 * merchantId 为商家自己时由调用方从登录态传入。
 */
export function queryStats(db, { from, to, merchantId = null, deviceId = null, withMerchants = false }) {
  const where = `s.day BETWEEN @from AND @to
    AND (@merchantId IS NULL OR s.merchant_id = @merchantId)
    AND (@deviceId IS NULL OR s.device_id = @deviceId)`;
  const params = { from, to, merchantId, deviceId };

  const totals = pickMetrics(db.prepare(`SELECT ${SUMS} FROM stat_daily s WHERE ${where}`).get(params));

  const byDay = new Map(
    db
      .prepare(`SELECT s.day AS day, ${SUMS} FROM stat_daily s WHERE ${where} GROUP BY s.day`)
      .all(params)
      .map((r) => [r.day, r]),
  );
  const daily = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += DAY_MS) {
    const day = dayOf(t);
    daily.push({ day, ...pickMetrics(byDay.get(day)) });
  }

  const byGarment = db
    .prepare(
      `SELECT s.garment_id AS garmentId, MAX(s.merchant_id) AS merchantId, g.title AS garmentTitle,
              g.deleted_at AS deletedAt, m.brand_name AS brandName, ${SUMS}
         FROM stat_daily s
         LEFT JOIN garment g ON g.id = s.garment_id
         LEFT JOIN merchant m ON m.account_id = g.merchant_id
        WHERE ${where} AND s.garment_id > 0
        GROUP BY s.garment_id
        ORDER BY tryonCount DESC, recommendCount DESC, s.garment_id
        LIMIT 1000`,
    )
    .all(params)
    .map((r) => ({
      garmentId: r.garmentId,
      garmentTitle: r.garmentTitle ?? '',
      garmentDeleted: r.deletedAt != null,
      merchantId: r.merchantId,
      brandName: r.brandName ?? '',
      ...pickMetrics(r),
    }));

  const out = { range: { from, to }, totals, daily, byGarment };
  if (withMerchants) {
    out.byMerchant = db
      .prepare(
        `SELECT s.merchant_id AS merchantId, m.brand_name AS brandName, a.username AS username, ${SUMS}
           FROM stat_daily s
           LEFT JOIN merchant m ON m.account_id = s.merchant_id
           LEFT JOIN account a ON a.id = s.merchant_id
          WHERE ${where}
          GROUP BY s.merchant_id
          ORDER BY tryonCount DESC, brandClicks DESC, s.merchant_id
          LIMIT 1000`,
      )
      .all(params)
      .map((r) => ({ merchantId: r.merchantId, brandName: r.brandName ?? '', username: r.username ?? '', ...pickMetrics(r) }));
  }
  return out;
}

// ---------- 导出：SpreadsheetML 2003（.xls，Excel / WPS 可直接打开），不引入依赖 ----------

const sec = (ms) => Math.round((ms || 0) / 1000);

const xmlEscape = (v) =>
  String(v ?? '')
    // XML 1.0 不允许的控制字符直接去掉
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 工作表名：最多 31 字符，不能含 []:*?/\
const sheetName = (name) => String(name).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';

/** sheets: [{ name, header: [..], rows: [[..]] }]；数字按 Number 单元格写出，其余一律 String（不会被当成公式） */
export function spreadsheetXml(sheets) {
  const cell = (v, style = '') => {
    const s = style ? ` ss:StyleID="${style}"` : '';
    return typeof v === 'number' && Number.isFinite(v)
      ? `<Cell${s}><Data ss:Type="Number">${v}</Data></Cell>`
      : `<Cell${s}><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
  };
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    '<Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>',
  ];
  for (const sh of sheets) {
    parts.push(`<Worksheet ss:Name="${xmlEscape(sheetName(sh.name))}"><Table>`);
    parts.push(`<Row>${sh.header.map((h) => cell(h, 'h')).join('')}</Row>`);
    for (const r of sh.rows) parts.push(`<Row>${r.map((v) => cell(v)).join('')}</Row>`);
    parts.push('</Table></Worksheet>');
  }
  parts.push('</Workbook>');
  return parts.join('\n');
}

const METRIC_HEADER = ['品牌点击次数', '品牌停留时长（秒）', '服饰试穿次数', '服饰试穿时长（秒）', '核销件数', '被 AI 推荐次数'];
const metricCells = (r) => [r.brandClicks, sec(r.brandDwellMs), r.tryonCount, sec(r.tryonMs), r.redeemCount, r.recommendCount];

/** 报表结果 → 工作簿：汇总、按日、按服饰，总后台再加按商家 */
export function statsWorkbook(stats, { title = '数据统计' } = {}) {
  const { range, totals, daily, byGarment, byMerchant } = stats;
  const sheets = [
    {
      name: '汇总',
      header: ['统计范围', ...METRIC_HEADER],
      rows: [[`${title} ${range.from} 至 ${range.to}（北京时间）`, ...metricCells(totals)]],
    },
    { name: '按日', header: ['日期', ...METRIC_HEADER], rows: daily.map((d) => [d.day, ...metricCells(d)]) },
    {
      name: '按服饰',
      header: ['服饰 ID', '服饰', '品牌', ...METRIC_HEADER],
      rows: byGarment.map((g) => [g.garmentId, g.garmentTitle + (g.garmentDeleted ? '（已删除）' : ''), g.brandName, ...metricCells(g)]),
    },
  ];
  if (byMerchant) {
    sheets.push({
      name: '按商家',
      header: ['商家 ID', '品牌', '用户名', ...METRIC_HEADER],
      rows: byMerchant.map((m) => [m.merchantId, m.brandName, m.username, ...metricCells(m)]),
    });
  }
  return spreadsheetXml(sheets);
}

/** 以附件形式回送 .xls；中文文件名走 RFC 5987 */
export function sendWorkbook(reply, xml, filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  reply
    .header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .header('Cache-Control', 'no-store');
  return reply.send(xml);
}
