import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approve, loginAdmin, makeApp, registerMerchant } from './helpers.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const MIN = 60_000;
const bearer = (token) => ({ authorization: `Bearer ${token}` });

/** 手工拼 multipart（与 garments.test.js 相同做法） */
function multipart(fields, file) {
  const boundary = '----shanshangPointsBoundary';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      file,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function setup() {
  const h = await makeApp();
  const admin = await loginAdmin(h.app);
  const m = await registerMerchant(h.app);
  await approve(h.app, admin, m.id);
  const d = (await h.app.inject({ method: 'GET', url: '/api/dicts' })).json();

  const inject = (method, url, cookie, payload) => h.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload });
  const adjust = (id, type, amount, note = '测试') => inject('POST', `/api/admin/merchants/${id}/points`, admin, { type, amount, note });

  /** 上传并由管理员提前通过，返回服饰 id */
  async function garment(cookie = m.cookie, title = '测试连衣裙') {
    const body = multipart({ title, gender: 'female', setType: 'single', categoryId: d.category[0].id, colorId: d.color[0].id }, JPEG);
    const r = await h.app.inject({ method: 'POST', url: '/api/merchant/garments', headers: { cookie, ...body.headers }, payload: body.payload });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().garment.id;
    await inject('POST', `/api/admin/garments/${id}/approve`, admin, {});
    return id;
  }

  async function device({ bind = true } = {}) {
    const dev = (await h.app.inject({ method: 'POST', url: '/api/device/register' })).json();
    if (bind) {
      const r = await inject('POST', '/api/admin/devices/bind', admin, { code: dev.code, name: '1 号机' });
      dev.id = r.json().device.id;
    }
    return dev;
  }

  const report = (token, payload) =>
    h.app.inject({ method: 'POST', url: '/api/device/tryon/segments', headers: bearer(token), payload });
  const balance = (id = m.id) => h.db.prepare('SELECT balance_milli FROM merchant WHERE account_id = ?').pluck().get(id);

  return { h, admin, m, inject, adjust, garment, device, report, balance };
}

test('扣费：按秒累计、默认 1 积分/分钟，扣到服饰所属商家；用量与扣费同口径', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  await s.adjust(s.m.id, 'add', 100);
  const g = await s.garment();
  const dev = await s.device();

  const r = await s.report(dev.token, {
    sessionId: 'sess-0001',
    segments: [
      { seq: 0, garmentId: g, durationMs: 45_000 },
      { seq: 1, garmentId: g, durationMs: 1_499 },
    ],
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json(), { accepted: 2, duplicates: 0, skipped: 0 });
  // 45000ms → 750 毫积分；1499ms → round(24.98) = 25
  assert.equal(s.balance(), 100_000 - 750 - 25);

  const mine = (await s.inject('GET', '/api/merchant/points', s.m.cookie)).json();
  assert.equal(mine.balanceMilli, 99_225);
  assert.equal(mine.balance, 99.23);
  assert.equal(mine.usageMs, 46_499);
  assert.equal(mine.hidden, false);
  assert.ok(!('xmaxRatio' in mine));

  // 改单价后按新单价计费
  await s.inject('PUT', '/api/admin/points/config', s.admin, { pointsPerMinute: 2 });
  await s.report(dev.token, { sessionId: 'sess-0001', segments: [{ seq: 2, garmentId: g, durationMs: 60_000 }] });
  assert.equal(s.balance(), 99_225 - 2000);

  const ledger = (await s.inject('GET', `/api/admin/points/ledger?merchantId=${s.m.id}&type=TRYON_CONSUME`, s.admin)).json();
  assert.equal(ledger.total, 3);
  const first = ledger.items.at(-1);
  assert.equal(first.amountMilli, -750);
  assert.equal(first.amount, -0.75);
  assert.equal(first.garmentId, g);
  assert.equal(first.garmentTitle, '测试连衣裙');
  assert.equal(first.deviceId, dev.id);
  assert.equal(first.durationMs, 45_000);
  assert.equal(first.brandName, '测试女装');
});

test('幂等：同一 device + session + seq 重复上报不重复扣费；换设备或会话照常计费', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  await s.adjust(s.m.id, 'add', 100);
  const g = await s.garment();
  const a = await s.device();
  const b = await s.device();
  const payload = { sessionId: 'sess-dup-1', segments: [{ seq: 0, garmentId: g, durationMs: 60_000 }] };

  assert.deepEqual((await s.report(a.token, payload)).json(), { accepted: 1, duplicates: 0, skipped: 0 });
  assert.deepEqual((await s.report(a.token, payload)).json(), { accepted: 0, duplicates: 1, skipped: 0 });
  // 一次请求里混合重复和新段
  const mixed = await s.report(a.token, {
    sessionId: 'sess-dup-1',
    segments: [
      { seq: 0, garmentId: g, durationMs: 60_000 },
      { seq: 1, garmentId: g, durationMs: 60_000 },
    ],
  });
  assert.deepEqual(mixed.json(), { accepted: 1, duplicates: 1, skipped: 0 });
  assert.equal(s.balance(), 98_000);

  assert.equal((await s.report(b.token, payload)).json().accepted, 1, '另一台设备同 session/seq 不算重复');
  assert.equal((await s.report(a.token, { ...payload, sessionId: 'sess-dup-2' })).json().accepted, 1);
  assert.equal(s.balance(), 96_000);
  assert.equal(s.h.db.prepare("SELECT COUNT(*) FROM point_ledger WHERE type = 'TRYON_CONSUME'").pluck().get(), 4);
});

test('不存在或已删除的服饰跳过，计入 skipped，不扣费', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  await s.adjust(s.m.id, 'add', 10);
  const g = await s.garment();
  const gone = await s.garment(s.m.cookie, '已删除');
  await s.inject('DELETE', `/api/merchant/garments/${gone}`, s.m.cookie);
  const dev = await s.device();

  const r = await s.report(dev.token, {
    sessionId: 'sess-skip1',
    segments: [
      { seq: 0, garmentId: 99999, durationMs: 60_000 },
      { seq: 1, garmentId: gone, durationMs: 60_000 },
      { seq: 2, garmentId: g, durationMs: 60_000 },
    ],
  });
  assert.deepEqual(r.json(), { accepted: 1, duplicates: 0, skipped: 2 });
  assert.equal(s.balance(), 9_000);
});

test('试穿中余额耗尽允许透支为负；低于阈值后服饰从设备清单隐藏，加积分先抵扣负数', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const g = await s.garment();
  const dev = await s.device();
  const list = async () => (await s.h.app.inject({ method: 'GET', url: '/api/device/garments', headers: bearer(dev.token) })).json().items;

  assert.equal((await list()).length, 0, '新商家余额 0 < 阈值 5，隐藏');
  await s.adjust(s.m.id, 'add', 5);
  assert.equal((await list()).length, 1, '余额 = 阈值时可见');

  await s.report(dev.token, { sessionId: 'sess-over1', segments: [{ seq: 0, garmentId: g, durationMs: 6 * MIN }] });
  assert.equal(s.balance(), -1_000, '透支为负');
  assert.equal((await list()).length, 0);
  const mine = (await s.inject('GET', '/api/merchant/points', s.m.cookie)).json();
  assert.equal(mine.balance, -1);
  assert.equal(mine.hidden, true);
  assert.equal(mine.hideThreshold, 5);

  const add = await s.adjust(s.m.id, 'add', 3);
  assert.deepEqual(add.json(), { balance: 2, balanceMilli: 2_000 }, '加积分先抵扣负数');
  assert.equal((await list()).length, 0);

  // 阈值调到 0 后立即可见
  await s.inject('PUT', '/api/admin/points/config', s.admin, { hideThreshold: 0 });
  assert.equal((await list()).length, 1);

  const row = (await s.inject('GET', '/api/admin/points/merchants', s.admin)).json().items.find((x) => x.merchantId === s.m.id);
  assert.deepEqual(row, {
    merchantId: s.m.id,
    username: 'shop01',
    brandName: '测试女装',
    status: 'approved',
    balance: 2,
    balanceMilli: 2_000,
    usageMs: 6 * MIN,
    hidden: false,
  });
});

test('管理员加扣积分：备注必填、写审计、流水 balanceAfter 正确；快照可由流水重算', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());

  assert.equal((await s.adjust(s.m.id, 'add', 0)).statusCode, 400);
  assert.equal((await s.adjust(s.m.id, 'add', 1_000_001)).statusCode, 400);
  assert.equal((await s.adjust(s.m.id, 'add', 10, '')).statusCode, 400);
  assert.equal((await s.adjust(s.m.id, 'add', 10, '   ')).statusCode, 400);
  assert.equal((await s.adjust(s.m.id, 'refund', 10)).statusCode, 400);
  assert.equal((await s.adjust(9999, 'add', 10)).statusCode, 404);

  assert.deepEqual((await s.adjust(s.m.id, 'add', 12.345, '线下转账')).json(), { balance: 12.35, balanceMilli: 12_345 });
  assert.deepEqual((await s.adjust(s.m.id, 'deduct', 20, '误充冲正')).json(), { balance: -7.66, balanceMilli: -7_655 });

  const ledger = (await s.inject('GET', '/api/admin/points/ledger', s.admin)).json();
  assert.equal(ledger.total, 2);
  assert.deepEqual(
    ledger.items.map((x) => [x.type, x.amountMilli, x.balanceAfter, x.note]),
    [
      ['ADMIN_DEDUCT', -20_000, -7.66, '误充冲正'],
      ['ADMIN_ADD', 12_345, 12.35, '线下转账'],
    ],
  );

  const sum = s.h.db.prepare('SELECT SUM(amount_milli) FROM point_ledger WHERE merchant_id = ?').pluck().get(s.m.id);
  assert.equal(sum, s.balance(), '余额快照 = 流水之和');

  const logs = (await s.inject('GET', '/api/admin/audit-logs', s.admin)).json().items;
  const add = logs.find((x) => x.action === 'points.add');
  const deduct = logs.find((x) => x.action === 'points.deduct');
  assert.equal(add.targetId, String(s.m.id));
  assert.equal(add.detail.note, '线下转账');
  assert.equal(deduct.detail.amountMilli, 20_000);
  assert.equal(add.actor, 'root');

  // 分页
  for (let i = 0; i < 3; i += 1) await s.adjust(s.m.id, 'add', 1);
  const p2 = (await s.inject('GET', '/api/admin/points/ledger?page=2&pageSize=2', s.admin)).json();
  assert.equal(p2.total, 5);
  assert.equal(p2.items.length, 2);
  assert.equal((await s.inject('GET', '/api/admin/points/ledger?pageSize=101', s.admin)).statusCode, 400);
});

test('商家只看自己的流水；充值信息可见，xmaxRatio 不出现在任何商家接口', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const other = await registerMerchant(s.h.app, { username: 'shop02', brandName: '别家' });
  await approve(s.h.app, s.admin, other.id);
  await s.adjust(s.m.id, 'add', 10, '给本店');
  await s.adjust(other.id, 'add', 20, '给别家');
  await s.inject('PUT', '/api/admin/points/config', s.admin, { xmaxRatio: '1:10', rechargeContact: '微信 shanshang' });

  const mine = (await s.inject('GET', '/api/merchant/points/ledger', s.m.cookie)).json();
  assert.equal(mine.total, 1);
  assert.equal(mine.items[0].note, '给本店');
  assert.equal(mine.items[0].merchantId, s.m.id);

  const recharge = await s.inject('GET', '/api/merchant/recharge', s.m.cookie);
  assert.deepEqual(recharge.json(), { contact: '微信 shanshang', qrUrl: '' });

  for (const url of ['/api/merchant/points', '/api/merchant/points/ledger', '/api/merchant/recharge', '/api/merchant/profile']) {
    const body = (await s.inject('GET', url, s.m.cookie)).body;
    assert.ok(!body.includes('xmaxRatio') && !body.includes('1:10'), `${url} 泄露换算比例`);
  }

  // 未审核商家不能看积分
  const pending = await registerMerchant(s.h.app, { username: 'shop03' });
  for (const url of ['/api/merchant/points', '/api/merchant/points/ledger', '/api/merchant/recharge']) {
    const r = await s.inject('GET', url, pending.cookie);
    assert.equal(r.statusCode, 403, url);
    assert.equal(r.json().error.code, 'MERCHANT_NOT_APPROVED');
  }
});

test('积分配置：部分更新、范围校验、写审计；收款码上传后商家可见', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const get = async () => (await s.inject('GET', '/api/admin/points/config', s.admin)).json();
  assert.deepEqual(await get(), {
    pointsPerMinute: 1,
    hideThreshold: 5,
    xmaxRatio: '',
    rechargeContact: '',
    rechargeQrUrl: '',
    tryonMaxMinutes: 5,
  });

  const put = (payload) => s.inject('PUT', '/api/admin/points/config', s.admin, payload);
  for (const bad of [
    {},
    { pointsPerMinute: 0 },
    { pointsPerMinute: 100.5 },
    { hideThreshold: -1 },
    { hideThreshold: 100_001 },
    { xmaxRatio: 'x'.repeat(21) },
    { rechargeContact: 'x'.repeat(201) },
    { tryonMaxMinutes: 0 },
    { tryonMaxMinutes: 31 },
    { tryonMaxMinutes: 2.5 },
    { pointsPerMinute: 'abc' },
    { unknown: 1 },
  ]) {
    assert.equal((await put(bad)).statusCode, 400, JSON.stringify(bad));
  }

  const ok = await put({ pointsPerMinute: 0.5, xmaxRatio: '1:10', tryonMaxMinutes: 30 });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json(), { ...(await get()), pointsPerMinute: 0.5, xmaxRatio: '1:10', tryonMaxMinutes: 30 });
  assert.equal((await get()).hideThreshold, 5, '未传的字段不变');

  const logs = (await s.inject('GET', '/api/admin/audit-logs', s.admin)).json().items;
  const cfg = logs.find((x) => x.action === 'points.config');
  assert.deepEqual(cfg.detail.changed.sort(), ['pointsPerMinute', 'tryonMaxMinutes', 'xmaxRatio']);

  // 收款码：非图片拒绝；图片存储后返回 config，可公开读取
  const upload = (file) => {
    const body = multipart({}, file);
    return s.h.app.inject({ method: 'POST', url: '/api/admin/points/recharge-qr', headers: { cookie: s.admin, ...body.headers }, payload: body.payload });
  };
  assert.equal((await upload(Buffer.from('not an image'))).statusCode, 400);
  assert.equal((await upload(null)).statusCode, 400);
  const qr = await upload(JPEG);
  assert.equal(qr.statusCode, 200, qr.body);
  const url = qr.json().rechargeQrUrl;
  assert.match(url, /^media\/recharge\/[a-f0-9]{24}\.jpg$/);
  assert.equal(qr.json().pointsPerMinute, 0.5);
  const img = await s.h.app.inject({ method: 'GET', url: `/api/${url}` });
  assert.equal(img.statusCode, 200);
  assert.ok(img.rawPayload.equals(JPEG));
  assert.equal((await s.inject('GET', '/api/merchant/recharge', s.m.cookie)).json().qrUrl, url);

  // 再传一张，旧图删除
  const url2 = (await upload(JPEG)).json().rechargeQrUrl;
  assert.notEqual(url2, url);
  assert.equal((await s.h.app.inject({ method: 'GET', url: `/api/${url}` })).statusCode, 404);
});

test('权限：商家和未登录不能调积分管理接口；未绑定设备不能上报、不能读配置', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const routes = [
    ['GET', '/api/admin/points/merchants'],
    ['POST', `/api/admin/merchants/${s.m.id}/points`],
    ['GET', '/api/admin/points/ledger'],
    ['GET', '/api/admin/points/config'],
    ['PUT', '/api/admin/points/config'],
    ['POST', '/api/admin/points/recharge-qr'],
  ];
  for (const [method, url] of routes) {
    assert.equal((await s.inject(method, url, null, {})).statusCode, 401, `${method} ${url} 未登录`);
    assert.equal((await s.inject(method, url, s.m.cookie, {})).statusCode, 403, `${method} ${url} 商家`);
  }
  assert.equal((await s.inject('GET', '/api/merchant/points', s.admin)).statusCode, 403, '管理员不能调商家积分接口');

  const g = await s.garment();
  const pending = await s.device({ bind: false });
  const payload = { sessionId: 'sess-perm1', segments: [{ seq: 0, garmentId: g, durationMs: 60_000 }] };
  const r = await s.report(pending.token, payload);
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().error.code, 'DEVICE_NOT_BOUND');
  const cfg = await s.h.app.inject({ method: 'GET', url: '/api/device/config', headers: bearer(pending.token) });
  assert.equal(cfg.statusCode, 403);
  assert.equal((await s.report('forged', payload)).statusCode, 401);
  assert.equal(s.h.db.prepare('SELECT COUNT(*) FROM point_ledger').pluck().get(), 0);

  // 停用设备同样拒绝
  const dev = await s.device();
  await s.inject('POST', `/api/admin/devices/${dev.id}/disable`, s.admin);
  assert.equal((await s.report(dev.token, payload)).statusCode, 403);
});

test('上报参数校验：durationMs 超 600000 直接 400，sessionId 格式、条数限制', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const g = await s.garment();
  const dev = await s.device();
  const seg = (o = {}) => ({ seq: 0, garmentId: g, durationMs: 1000, ...o });
  for (const bad of [
    { sessionId: 'sess-val1', segments: [seg({ durationMs: 600_001 })] },
    { sessionId: 'sess-val1', segments: [seg({ durationMs: -1 })] },
    { sessionId: 'sess-val1', segments: [seg({ durationMs: 1.5 })] },
    { sessionId: 'sess-val1', segments: [seg({ seq: -1 })] },
    { sessionId: 'sess-val1', segments: [] },
    { sessionId: 'sess-val1', segments: Array.from({ length: 51 }, (_, i) => seg({ seq: i })) },
    { sessionId: 'short', segments: [seg()] },
    { sessionId: 'x'.repeat(65), segments: [seg()] },
    { sessionId: 'bad session!', segments: [seg()] },
    { segments: [seg()] },
    { sessionId: 'sess-val1', segments: [{ ...seg(), extra: 1 }] },
  ]) {
    assert.equal((await s.report(dev.token, bad)).statusCode, 400, JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(s.h.db.prepare('SELECT COUNT(*) FROM point_ledger').pluck().get(), 0, '整批拒绝，不部分扣费');

  const edge = await s.report(dev.token, {
    sessionId: 'A_b-' + 'c'.repeat(60),
    segments: [seg({ durationMs: 600_000 }), seg({ seq: 1, durationMs: 0 })],
  });
  assert.equal(edge.statusCode, 200, edge.body);
  assert.equal(edge.json().accepted, 2);
});

test('心跳与背景：未绑定也可心跳；2 分钟内在线；总后台设置背景，设备端同步', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const pending = await s.device({ bind: false });
  const hb = await s.h.app.inject({ method: 'POST', url: '/api/device/heartbeat', headers: bearer(pending.token) });
  assert.equal(hb.statusCode, 200);
  assert.deepEqual(hb.json(), { ok: true, background: 'black', serverTime: s.h.db ? hb.json().serverTime : 0 });
  assert.equal(typeof hb.json().serverTime, 'number');
  assert.equal((await s.h.app.inject({ method: 'POST', url: '/api/device/heartbeat' })).statusCode, 401);

  const dev = await s.device();
  const devices = async () => (await s.inject('GET', '/api/admin/devices', s.admin)).json().items;
  const find = async (id) => (await devices()).find((x) => x.id === id);
  // 绑定后还没有请求过 → 不在线
  assert.equal((await find(dev.id)).online, false);
  assert.equal((await find(dev.id)).background, 'black');

  await s.h.app.inject({ method: 'POST', url: '/api/device/heartbeat', headers: bearer(dev.token) });
  assert.equal((await find(dev.id)).online, true);
  s.h.advance(2 * MIN);
  assert.equal((await find(dev.id)).online, true, '恰好 2 分钟仍在线');
  s.h.advance(1000);
  assert.equal((await find(dev.id)).online, false);

  const patch = (payload) => s.inject('PATCH', `/api/admin/devices/${dev.id}`, s.admin, payload);
  assert.equal((await patch({ background: 'red' })).statusCode, 400);
  const ok = await patch({ background: 'white' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().device.background, 'white');
  assert.equal(ok.json().device.name, '1 号机', '只改背景，名称不变');

  const status = (await s.h.app.inject({ method: 'GET', url: '/api/device/status', headers: bearer(dev.token) })).json();
  assert.equal(status.background, 'white');
  assert.equal(status.status, 'bound');
  const beat = (await s.h.app.inject({ method: 'POST', url: '/api/device/heartbeat', headers: bearer(dev.token) })).json();
  assert.equal(beat.background, 'white');
  assert.equal(beat.serverTime, Date.UTC(2026, 9, 30, 8, 2, 1));

  await s.inject('PUT', '/api/admin/settings', s.admin, { platformName: '闪裳测试' });
  const cfg = await s.h.app.inject({ method: 'GET', url: '/api/device/config', headers: bearer(dev.token) });
  assert.deepEqual(cfg.json(), { platformName: '闪裳测试', logoUrl: '', background: 'white', tryonMaxMinutes: 5 });
});
