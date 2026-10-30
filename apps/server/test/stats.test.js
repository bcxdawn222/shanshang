import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approve, loginAdmin, makeApp, registerMerchant } from './helpers.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const MIN = 60_000;
// helpers.js 的初始时钟：2026-10-30 08:00 UTC = 北京时间 2026-10-30 16:00
const T0 = Date.UTC(2026, 9, 30, 8, 0, 0);
const bearer = (token) => ({ authorization: `Bearer ${token}` });

/** 手工拼 multipart；files: [{ field, data }] */
function multipart(fields, files = []) {
  const boundary = '----shanshangStatsBoundary';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      f.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function setup() {
  const h = await makeApp();
  const admin = await loginAdmin(h.app);
  const d = (await h.app.inject({ method: 'GET', url: '/api/dicts' })).json();
  const inject = (method, url, cookie, payload) => h.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload });

  async function merchant(username, brandName) {
    const m = await registerMerchant(h.app, { username, password: `${username}-pass-01`, brandName });
    await approve(h.app, admin, m.id);
    await inject('POST', `/api/admin/merchants/${m.id}/points`, admin, { type: 'add', amount: 100, note: '测试充值' });
    return m;
  }

  async function garment(m, title = '测试连衣裙') {
    const body = multipart({ title, gender: 'female', setType: 'single', categoryId: d.category[0].id, colorId: d.color[0].id }, [
      { field: 'image', data: JPEG },
    ]);
    const r = await h.app.inject({ method: 'POST', url: '/api/merchant/garments', headers: { cookie: m.cookie, ...body.headers }, payload: body.payload });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().garment.id;
    await inject('POST', `/api/admin/garments/${id}/approve`, admin, {});
    return id;
  }

  async function device({ bind = true, name = '1 号机' } = {}) {
    const dev = (await h.app.inject({ method: 'POST', url: '/api/device/register' })).json();
    if (bind) dev.id = (await inject('POST', '/api/admin/devices/bind', admin, { code: dev.code, name })).json().device.id;
    return dev;
  }

  const send = (dev, events, sessionId = 'sess-0001') =>
    h.app.inject({ method: 'POST', url: '/api/device/events', headers: bearer(dev.token), payload: { sessionId, events } });

  return { h, admin, inject, merchant, garment, device, send };
}

test('埋点上报：鉴权、校验、按 device + session + seq 去重', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m = await s.merchant('shop01', '测试女装');
  const g = await s.garment(m);
  const dev = await s.device();

  const ev = [{ seq: 0, type: 'brand_click', ts: T0, merchantId: m.id }];
  assert.equal((await s.h.app.inject({ method: 'POST', url: '/api/device/events', payload: { sessionId: 'sess-0001', events: ev } })).statusCode, 401);
  const unbound = await s.device({ bind: false });
  const r403 = await s.send(unbound, ev);
  assert.equal(r403.statusCode, 403);
  assert.equal(r403.json().error.code, 'DEVICE_NOT_BOUND');

  // 参数校验：空批、超 50 条、未知类型、多余字段
  assert.equal((await s.send(dev, [])).statusCode, 400);
  const many = Array.from({ length: 51 }, (_, seq) => ({ seq, type: 'brand_click', ts: T0, merchantId: m.id }));
  assert.equal((await s.send(dev, many)).statusCode, 400);
  assert.equal((await s.send(dev, [{ seq: 0, type: 'snapshot_scan', ts: T0 }])).statusCode, 400);
  assert.equal((await s.send(dev, [{ seq: 0, type: 'brand_click', ts: T0, merchantId: m.id, foo: 1 }])).statusCode, 400);

  const first = await s.send(dev, [
    { seq: 0, type: 'brand_click', ts: T0, merchantId: m.id },
    { seq: 1, type: 'tryon_start', ts: T0, garmentId: g, merchantId: m.id },
  ]);
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(first.json(), { accepted: 2, duplicates: 0, skipped: 0 });

  // 断网补报：同一批再发一次 + 一条新的
  const again = await s.send(dev, [
    { seq: 0, type: 'brand_click', ts: T0, merchantId: m.id },
    { seq: 1, type: 'tryon_start', ts: T0, garmentId: g },
    { seq: 2, type: 'brand_click', ts: T0, merchantId: m.id },
  ]);
  assert.deepEqual(again.json(), { accepted: 1, duplicates: 2, skipped: 0 });
  // 换会话、换设备同 seq 不算重复
  assert.equal((await s.send(dev, ev, 'sess-0002')).json().accepted, 1);
  const dev2 = await s.device({ name: '2 号机' });
  assert.equal((await s.send(dev2, ev)).json().accepted, 1);

  // 商家 / 服饰不存在、缺必需字段的跳过
  const skipped = await s.send(dev, [
    { seq: 10, type: 'brand_click', ts: T0, merchantId: 99999 },
    { seq: 11, type: 'tryon_start', ts: T0, garmentId: 99999 },
    { seq: 12, type: 'tryon_end', ts: T0, garmentId: g },
    { seq: 13, type: 'brand_dwell', ts: T0, merchantId: m.id },
    { seq: 14, type: 'ai_recommend', ts: T0, garmentIds: [99999] },
  ]);
  assert.deepEqual(skipped.json(), { accepted: 0, duplicates: 0, skipped: 5 });

  assert.equal(s.h.db.prepare('SELECT COUNT(*) FROM event').pluck().get(), 5);
  const stats = (await s.inject('GET', '/api/merchant/stats?from=2026-10-30&to=2026-10-30', m.cookie)).json();
  assert.equal(stats.totals.brandClicks, 4);
  assert.equal(stats.totals.tryonCount, 1);
});

test('统计口径：停留上限 10 分钟、30 秒内重复试穿不计、试穿时长、AI 推荐、上报不扣费', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m = await s.merchant('shop01', '测试女装');
  const g1 = await s.garment(m, '连衣裙 A');
  const g2 = await s.garment(m, '衬衫 B');
  const dev = await s.device();
  const balance = () => s.h.db.prepare('SELECT balance_milli FROM merchant WHERE account_id = ?').pluck().get(m.id);
  const before = balance();

  const r = await s.send(dev, [
    { seq: 0, type: 'brand_click', ts: T0, merchantId: m.id },
    { seq: 1, type: 'brand_dwell', ts: T0, merchantId: m.id, durationMs: 15 * MIN },
    { seq: 2, type: 'brand_dwell', ts: T0, merchantId: m.id, durationMs: 30_000 },
    { seq: 3, type: 'tryon_start', ts: T0, garmentId: g1 },
    // 29 秒后同一服饰再次出画面：不计
    { seq: 4, type: 'tryon_start', ts: T0 + 29_000, garmentId: g1 },
    // 距第一次计数 31 秒：计
    { seq: 5, type: 'tryon_start', ts: T0 + 31_000, garmentId: g1 },
    // 另一件服饰不受影响
    { seq: 6, type: 'tryon_start', ts: T0 + 1000, garmentId: g2 },
    { seq: 7, type: 'tryon_end', ts: T0 + 40_000, garmentId: g1, durationMs: 40_000 },
    { seq: 8, type: 'tryon_end', ts: T0 + 40_000, garmentId: g2, durationMs: 20 * MIN },
    { seq: 9, type: 'ai_recommend', ts: T0, garmentIds: [g1, g2, g1], questionKey: 'scene' },
    { seq: 10, type: 'snapshot_create', ts: T0, garmentId: g1, snapshotId: 1 },
  ]);
  assert.deepEqual(r.json(), { accepted: 11, duplicates: 0, skipped: 0 });
  // 另一会话同服饰：不受本会话 30 秒去重影响
  await s.send(dev, [{ seq: 0, type: 'tryon_start', ts: T0 + 2000, garmentId: g1 }], 'sess-other');

  assert.equal(balance(), before, '埋点上报不扣费');
  const stats = (await s.inject('GET', '/api/merchant/stats?from=2026-10-30&to=2026-10-30', m.cookie)).json();
  assert.deepEqual(stats.totals, {
    brandClicks: 1,
    brandDwellMs: 10 * MIN + 30_000,
    tryonCount: 4,
    tryonMs: 40_000 + 10 * MIN,
    redeemCount: 0,
    recommendCount: 2,
  });
  const a = stats.byGarment.find((x) => x.garmentId === g1);
  assert.equal(a.garmentTitle, '连衣裙 A');
  assert.equal(a.tryonCount, 3);
  assert.equal(a.recommendCount, 1);
  assert.equal(a.brandClicks, 0);
  assert.equal(stats.byGarment.find((x) => x.garmentId === g2).tryonCount, 1);
  // 明细与汇总一致
  assert.equal(s.h.db.prepare("SELECT COUNT(*) FROM event WHERE type = 'tryon_start' AND counted = 1").pluck().get(), 4);
  assert.equal(stats.byMerchant, undefined, '商家报表不含 byMerchant');
});

test('日期：按北京时间归日，范围校验，daily 补齐空日', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m = await s.merchant('shop01', '测试女装');
  const dev = await s.device();
  const get = (qs) => s.inject('GET', `/api/merchant/stats${qs}`, m.cookie);

  // 服务端时钟拨到北京时间 10-31 16:00（UTC 08:00），再补报前一天的事件
  s.h.advance(24 * 60 * MIN);
  // 北京时间 10-30 23:59 与 10-31 00:00（UTC 15:59 / 16:00）
  await s.send(dev, [
    { seq: 0, type: 'brand_click', ts: Date.UTC(2026, 9, 30, 15, 59), merchantId: m.id },
    { seq: 1, type: 'brand_click', ts: Date.UTC(2026, 9, 30, 16, 0), merchantId: m.id },
    // 设备时钟超前 1 天：改用服务端时间（10-31）
    { seq: 2, type: 'brand_click', ts: T0 + 48 * 60 * MIN, merchantId: m.id },
    // 早于 7 天：同样改用服务端时间（10-31）
    { seq: 3, type: 'brand_click', ts: T0 - 8 * 24 * 60 * MIN, merchantId: m.id },
  ]);

  const r = await get('?from=2026-10-29&to=2026-10-31');
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.deepEqual(body.range, { from: '2026-10-29', to: '2026-10-31' });
  assert.deepEqual(
    body.daily.map((x) => [x.day, x.brandClicks]),
    [
      ['2026-10-29', 0],
      ['2026-10-30', 1],
      ['2026-10-31', 3],
    ],
  );
  assert.equal((await get('?from=2026-10-31&to=2026-10-31')).json().totals.brandClicks, 3);

  // 默认近 30 天，截止北京时间今天（10-31）
  const def = (await get('')).json();
  assert.deepEqual(def.range, { from: '2026-10-02', to: '2026-10-31' });
  assert.equal(def.daily.length, 30);

  for (const qs of ['?from=2026-10-31&to=2026-10-30', '?from=2026-02-30&to=2026-03-01', '?from=20261030', '?from=2025-10-30&to=2026-10-31']) {
    assert.equal((await get(qs)).statusCode, 400, qs);
  }
  // 366 天（含首尾）可以
  const max = await get('?from=2025-10-31&to=2026-10-31');
  assert.equal(max.statusCode, 200, max.body);
  assert.equal(max.json().daily.length, 366);
});

test('核销计入 redeem_count；商家只看自己；总后台可按商家、设备筛选', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m1 = await s.merchant('shop01', '测试女装');
  const m2 = await s.merchant('shop02', '隔壁男装');
  const g1 = await s.garment(m1, '连衣裙 A');
  const g2 = await s.garment(m2, '夹克 B');
  const dev1 = await s.device({ name: '1 号机' });
  const dev2 = await s.device({ name: '2 号机' });

  await s.send(dev1, [
    { seq: 0, type: 'tryon_start', ts: T0, garmentId: g1 },
    // 上报的 merchantId 与服饰归属不一致：以服饰归属为准
    { seq: 1, type: 'tryon_start', ts: T0, garmentId: g2, merchantId: m1.id },
    { seq: 2, type: 'brand_click', ts: T0, merchantId: m2.id },
  ]);
  await s.send(dev2, [{ seq: 0, type: 'tryon_start', ts: T0, garmentId: g2 }]);

  // 设备 1 生成快照，商家 1 核销
  const snap = (await s.h.app.inject({ method: 'POST', url: '/api/device/snapshots', headers: bearer(dev1.token), payload: { garmentId: g1 } })).json();
  const body = multipart({}, [{ field: 'image', data: JPEG }]);
  const up = await s.h.app.inject({ method: 'PUT', url: `/api/device/snapshots/${snap.id}/image`, headers: { ...bearer(dev1.token), ...body.headers }, payload: body.payload });
  assert.equal(up.statusCode, 200, up.body);
  assert.equal((await s.inject('POST', '/api/merchant/redeem', m1.cookie, { code: snap.code })).statusCode, 200);
  // 重复核销失败不重复计数
  assert.equal((await s.inject('POST', '/api/merchant/redeem', m1.cookie, { code: snap.code })).statusCode, 409);

  const q = '?from=2026-10-30&to=2026-10-30';
  const s1 = (await s.inject('GET', `/api/merchant/stats${q}`, m1.cookie)).json();
  assert.equal(s1.totals.tryonCount, 1);
  assert.equal(s1.totals.redeemCount, 1);
  assert.equal(s1.totals.brandClicks, 0);
  assert.deepEqual(s1.byGarment.map((x) => x.garmentId), [g1]);
  const s2 = (await s.inject('GET', `/api/merchant/stats${q}`, m2.cookie)).json();
  assert.equal(s2.totals.tryonCount, 2);
  assert.equal(s2.totals.brandClicks, 1);
  assert.equal(s2.totals.redeemCount, 0);
  // 商家不能传 merchantId 看别人
  assert.equal((await s.inject('GET', `/api/merchant/stats${q}&merchantId=${m2.id}`, m1.cookie)).statusCode, 400);

  const all = (await s.inject('GET', `/api/admin/stats${q}`, s.admin)).json();
  assert.equal(all.totals.tryonCount, 3);
  assert.equal(all.totals.redeemCount, 1);
  assert.deepEqual(
    all.byMerchant.map((x) => [x.merchantId, x.brandName, x.tryonCount]),
    [
      [m2.id, '隔壁男装', 2],
      [m1.id, '测试女装', 1],
    ],
  );
  const byM = (await s.inject('GET', `/api/admin/stats${q}&merchantId=${m1.id}`, s.admin)).json();
  assert.equal(byM.totals.tryonCount, 1);
  assert.equal(byM.totals.redeemCount, 1);
  const byD = (await s.inject('GET', `/api/admin/stats${q}&deviceId=${dev2.id}`, s.admin)).json();
  assert.equal(byD.totals.tryonCount, 1);
  assert.equal(byD.totals.redeemCount, 0);
  assert.deepEqual(byD.byGarment.map((x) => x.garmentId), [g2]);
  const both = (await s.inject('GET', `/api/admin/stats${q}&merchantId=${m2.id}&deviceId=${dev1.id}`, s.admin)).json();
  assert.equal(both.totals.tryonCount, 1);
  assert.equal(both.totals.brandClicks, 1);
});

test('权限：未登录 401、角色不符 403、待审核商家不能看统计', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m = await s.merchant('shop01', '测试女装');
  const pending = await registerMerchant(s.h.app, { username: 'shop09', password: 'shop09-pass-01', brandName: '待审' });

  for (const url of ['/api/merchant/stats', '/api/merchant/stats/export']) {
    assert.equal((await s.inject('GET', url)).statusCode, 401, url);
    assert.equal((await s.inject('GET', url, s.admin)).statusCode, 403, url);
    assert.equal((await s.inject('GET', url, pending.cookie)).statusCode, 403, url);
  }
  for (const url of ['/api/admin/stats', '/api/admin/stats/export']) {
    assert.equal((await s.inject('GET', url)).statusCode, 401, url);
    assert.equal((await s.inject('GET', url, m.cookie)).statusCode, 403, url);
  }
});

test('导出 Excel：SpreadsheetML，含各工作表，内容转义，总后台写审计', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m = await s.merchant('shop01', '测试女装');
  const g = await s.garment(m, '<裙&"子">');
  const dev = await s.device();
  await s.send(dev, [
    { seq: 0, type: 'tryon_start', ts: T0, garmentId: g },
    { seq: 1, type: 'tryon_end', ts: T0, garmentId: g, durationMs: 61_400 },
  ]);

  const r = await s.inject('GET', '/api/merchant/stats/export?from=2026-10-29&to=2026-10-30', m.cookie);
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.headers['content-type'], /^application\/vnd\.ms-excel/);
  assert.match(r.headers['content-disposition'], /^attachment; filename="[^"]+\.xls"; filename\*=UTF-8''/);
  assert.ok(decodeURIComponent(r.headers['content-disposition'].split("''")[1]).endsWith('数据统计_2026-10-29_2026-10-30.xls'));
  const xml = r.body;
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  for (const name of ['汇总', '按日', '按服饰']) assert.ok(xml.includes(`ss:Name="${name}"`), name);
  assert.ok(!xml.includes('ss:Name="按商家"'));
  assert.ok(xml.includes('&lt;裙&amp;&quot;子&quot;&gt;'));
  assert.ok(!xml.includes('<裙'));
  assert.ok(xml.includes('<Data ss:Type="String">2026-10-29</Data>'));
  // 试穿时长按秒（61.4 秒 → 61）
  assert.ok(xml.includes('<Data ss:Type="Number">61</Data>'));

  const a = await s.inject('GET', '/api/admin/stats/export?from=2026-10-30&to=2026-10-30', s.admin);
  assert.equal(a.statusCode, 200);
  assert.ok(a.body.includes('ss:Name="按商家"'));
  const logs = (await s.inject('GET', '/api/admin/audit-logs', s.admin)).json().items;
  const exp = logs.find((x) => x.action === 'stats.export');
  assert.deepEqual(exp.detail, { from: '2026-10-30', to: '2026-10-30', merchantId: null, deviceId: null });

  assert.equal((await s.inject('GET', '/api/admin/stats/export?from=2026-10-31&to=2026-10-30', s.admin)).statusCode, 400);
});
