import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loginAdmin, makeApp } from './helpers.js';

async function registerDevice(app) {
  const r = await app.inject({ method: 'POST', url: '/api/device/register' });
  assert.equal(r.statusCode, 201);
  return r.json();
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });

async function bind(app, admin, code, name = '1 号机') {
  return app.inject({
    method: 'POST',
    url: '/api/admin/devices/bind',
    headers: { cookie: admin },
    payload: { code, name, location: '商场 1F 中庭' },
  });
}

test('设备注册：拿到 8 位设备码和令牌，库里只存令牌哈希', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const d = await registerDevice(h.app);
  assert.match(d.code, /^[A-HJKMNP-Z2-9]{8}$/);
  assert.ok(d.token.length >= 40);
  const stored = h.db.prepare('SELECT secret_hash FROM device WHERE code = ?').pluck().get(d.code);
  assert.notEqual(stored, d.token);

  const status = await h.app.inject({ method: 'GET', url: '/api/device/status', headers: bearer(d.token) });
  assert.equal(status.json().status, 'pending');
});

test('未绑定设备拿不到临时密钥，也不调用 Xmax（DVC-02）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const d = await registerDevice(h.app);

  const r = await h.app.inject({ method: 'POST', url: '/api/device/xmax-key', headers: bearer(d.token) });
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().error.code, 'DEVICE_NOT_BOUND');
  assert.equal(h.calls.length, 0);
});

test('无凭证、错误凭证被拒', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const none = await h.app.inject({ method: 'POST', url: '/api/device/xmax-key' });
  assert.equal(none.statusCode, 401);
  const wrong = await h.app.inject({ method: 'POST', url: '/api/device/xmax-key', headers: bearer('forged') });
  assert.equal(wrong.statusCode, 401);
  assert.equal(h.calls.length, 0);
});

test('绑定后可换临时密钥；永久密钥只在服务端请求头里（DVC-01）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const d = await registerDevice(h.app);

  const bound = await bind(h.app, admin, d.code.toLowerCase());
  assert.equal(bound.statusCode, 200, '设备码不区分大小写');
  assert.equal(bound.json().device.status, 'bound');
  assert.equal(bound.json().device.location, '商场 1F 中庭');
  assert.equal((await bind(h.app, admin, d.code)).statusCode, 409, '重复绑定被拒');

  const r = await h.app.inject({ method: 'POST', url: '/api/device/xmax-key', headers: bearer(d.token) });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().temporaryApiKey, 'test-temporary-key');
  assert.ok(!r.body.includes('test-permanent-key'), '响应不含永久密钥');

  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://xmax.example.test/open/api/v1/temporary-api-key');
  assert.equal(h.calls[0].init.headers['X-Api-Key'], 'test-permanent-key');
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { expireSeconds: 3600, pointsLimit: 200 });
});

test('不存在的设备码绑定返回 404', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  assert.equal((await bind(h.app, admin, 'ZZZZZZZZ')).statusCode, 404);
});

test('停用设备后立刻拿不到密钥；启用后恢复为已绑定', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const d = await registerDevice(h.app);
  const id = (await bind(h.app, admin, d.code)).json().device.id;

  const off = await h.app.inject({ method: 'POST', url: `/api/admin/devices/${id}/disable`, headers: { cookie: admin } });
  assert.equal(off.statusCode, 200);
  const denied = await h.app.inject({ method: 'POST', url: '/api/device/xmax-key', headers: bearer(d.token) });
  assert.equal(denied.statusCode, 403);

  const on = await h.app.inject({ method: 'POST', url: `/api/admin/devices/${id}/enable`, headers: { cookie: admin } });
  assert.equal(on.json().device.status, 'bound');
  const ok = await h.app.inject({ method: 'POST', url: '/api/device/xmax-key', headers: bearer(d.token) });
  assert.equal(ok.statusCode, 200);
});

test('Xmax 异常时返回 502，不泄露上游内容', async (t) => {
  const h = await makeApp({
    fetchImpl: async () => new Response('upstream secret detail', { status: 500 }),
  });
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const d = await registerDevice(h.app);
  await bind(h.app, admin, d.code);
  const r = await h.app.inject({ method: 'POST', url: '/api/device/xmax-key', headers: bearer(d.token) });
  assert.equal(r.statusCode, 502);
  assert.ok(!r.body.includes('upstream secret detail'));
});

test('未配置 Xmax 时返回 503，health 显示未配置', async (t) => {
  const h = await makeApp({ env: { XMAX_API_KEY: '' } });
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const d = await registerDevice(h.app);
  await bind(h.app, admin, d.code);
  const r = await h.app.inject({ method: 'POST', url: '/api/device/xmax-key', headers: bearer(d.token) });
  assert.equal(r.statusCode, 503);
  const health = await h.app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.json().xmaxKeyConfigured, false);
});

test('单台设备领密钥限流：1 小时 30 次', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const d = await registerDevice(h.app);
  await bind(h.app, admin, d.code);
  for (let i = 0; i < 30; i += 1) {
    const r = await h.app.inject({ method: 'POST', url: '/api/device/xmax-key', headers: bearer(d.token) });
    assert.equal(r.statusCode, 200);
  }
  const over = await h.app.inject({ method: 'POST', url: '/api/device/xmax-key', headers: bearer(d.token) });
  assert.equal(over.statusCode, 429);
  assert.equal(h.calls.length, 30);
});

test('同一 IP 注册设备限流：1 小时 10 台', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  for (let i = 0; i < 10; i += 1) await registerDevice(h.app);
  const over = await h.app.inject({ method: 'POST', url: '/api/device/register' });
  assert.equal(over.statusCode, 429);
});
