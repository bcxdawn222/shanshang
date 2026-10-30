import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approve, cookieOf, loginAdmin, makeApp, registerMerchant } from './helpers.js';

async function post(app, url, cookie, payload = {}) {
  return app.inject({ method: 'POST', url, headers: { cookie }, payload });
}

test('商家和未登录用户访问管理接口一律被拒', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const m = await registerMerchant(h.app);
  const admin = await loginAdmin(h.app);
  await approve(h.app, admin, m.id);

  const routes = [
    ['GET', '/api/admin/merchants'],
    ['POST', `/api/admin/merchants/${m.id}/approve`],
    ['POST', `/api/admin/merchants/${m.id}/disable`],
    ['POST', `/api/admin/merchants/${m.id}/reset-password`],
    ['GET', '/api/admin/devices'],
    ['POST', '/api/admin/devices/bind'],
    ['GET', '/api/admin/settings'],
    ['PUT', '/api/admin/settings'],
    ['GET', '/api/admin/audit-logs'],
  ];
  for (const [method, url] of routes) {
    const anon = await h.app.inject({ method, url, payload: {} });
    assert.equal(anon.statusCode, 401, `${method} ${url} 未登录`);
    const asMerchant = await h.app.inject({ method, url, headers: { cookie: m.cookie }, payload: {} });
    assert.equal(asMerchant.statusCode, 403, `${method} ${url} 商家`);
  }
});

test('管理员不能调用商家接口', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const r = await h.app.inject({ method: 'GET', url: '/api/merchant/profile', headers: { cookie: admin } });
  assert.equal(r.statusCode, 403);
});

test('审核：通过 / 驳回需要原因 / 重复操作被拒（ACC-03）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const a = await registerMerchant(h.app, { username: 'shopa' });
  const b = await registerMerchant(h.app, { username: 'shopb' });

  const passed = await approve(h.app, admin, a.id);
  assert.equal(passed.account.status, 'approved');
  assert.equal(passed.account.merchant.slotQuota, 18);
  assert.equal((await post(h.app, `/api/admin/merchants/${a.id}/approve`, admin)).statusCode, 409);

  assert.equal((await post(h.app, `/api/admin/merchants/${b.id}/reject`, admin, {})).statusCode, 400);
  assert.equal((await post(h.app, `/api/admin/merchants/${b.id}/reject`, admin, { note: '   ' })).statusCode, 400);
  const rejected = await post(h.app, `/api/admin/merchants/${b.id}/reject`, admin, { note: '资料不全' });
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.json().account.merchant.reviewNote, '资料不全');

  const list = await h.app.inject({
    method: 'GET',
    url: '/api/admin/merchants?status=rejected',
    headers: { cookie: admin },
  });
  assert.deepEqual(
    list.json().items.map((x) => x.username),
    ['shopb'],
  );

  assert.equal((await post(h.app, '/api/admin/merchants/9999/approve', admin)).statusCode, 404);
});

test('停用：不能登录、会话立即失效（ACC-07）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const m = await registerMerchant(h.app);
  await approve(h.app, admin, m.id);

  assert.equal((await post(h.app, `/api/admin/merchants/${m.id}/disable`, admin)).statusCode, 200);
  const me = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: m.cookie } });
  assert.equal(me.statusCode, 401);
  const login = await h.app.inject({
    method: 'POST',
    url: '/api/auth/merchant/login',
    payload: { username: m.username, password: m.password },
  });
  assert.equal(login.statusCode, 403);
  assert.equal(login.json().error.code, 'ACCOUNT_DISABLED');
});

test('启用恢复停用前的状态，不能借“驳回 → 停用 → 启用”跳过审核', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);

  const cases = [
    { username: 'pend01', setup: async () => {}, expect: 'pending' },
    {
      username: 'rej001',
      setup: async (id) => post(h.app, `/api/admin/merchants/${id}/reject`, admin, { note: '不合格' }),
      expect: 'rejected',
    },
    { username: 'appr01', setup: async (id) => approve(h.app, admin, id), expect: 'approved' },
  ];
  for (const c of cases) {
    const m = await registerMerchant(h.app, { username: c.username });
    await c.setup(m.id);
    assert.equal((await post(h.app, `/api/admin/merchants/${m.id}/disable`, admin)).statusCode, 200);
    const enabled = await post(h.app, `/api/admin/merchants/${m.id}/enable`, admin);
    assert.equal(enabled.statusCode, 200);
    assert.equal(enabled.json().account.status, c.expect, c.username);
  }
});

test('重置密码：返回一次临时密码，旧密码和旧会话失效，日志不含密码', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const m = await registerMerchant(h.app);
  await approve(h.app, admin, m.id);

  const r = await post(h.app, `/api/admin/merchants/${m.id}/reset-password`, admin);
  assert.equal(r.statusCode, 200);
  const { temporaryPassword } = r.json();
  assert.equal(temporaryPassword.length, 12);

  const me = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: m.cookie } });
  assert.equal(me.statusCode, 401);
  const oldLogin = await h.app.inject({
    method: 'POST',
    url: '/api/auth/merchant/login',
    payload: { username: m.username, password: m.password },
  });
  assert.equal(oldLogin.statusCode, 401);
  const newLogin = await h.app.inject({
    method: 'POST',
    url: '/api/auth/merchant/login',
    payload: { username: m.username, password: temporaryPassword },
  });
  assert.equal(newLogin.statusCode, 200);

  const logs = h.db.prepare('SELECT detail FROM audit_log').pluck().all().join('\n');
  assert.ok(!logs.includes(temporaryPassword));
});

test('平台设置：管理员可改，公开接口可读，商家无修改入口（ACC-05）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);

  const pub = await h.app.inject({ method: 'GET', url: '/api/settings/public' });
  assert.equal(pub.json().platformName, '闪裳Live');

  const bad = await h.app.inject({
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { cookie: admin },
    payload: { logoUrl: 'javascript:alert(1)' },
  });
  assert.equal(bad.statusCode, 400);

  const put = await h.app.inject({
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { cookie: admin },
    payload: { loginBgUrl: '/sl/assets/login-bg.jpg' },
  });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().loginBgUrl, '/sl/assets/login-bg.jpg');
  assert.equal(put.json().platformName, '闪裳Live');
});

test('审计日志覆盖登录、审核、停用、设置（ACC-08）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const m = await registerMerchant(h.app);
  await approve(h.app, admin, m.id);
  await post(h.app, `/api/admin/merchants/${m.id}/disable`, admin);
  await h.app.inject({
    method: 'PUT',
    url: '/api/admin/settings',
    headers: { cookie: admin },
    payload: { platformName: '闪裳Live' },
  });

  const r = await h.app.inject({ method: 'GET', url: '/api/admin/audit-logs', headers: { cookie: admin } });
  const actions = r.json().items.map((x) => x.action);
  for (const a of ['admin.login', 'merchant.approve', 'merchant.disable', 'settings.update']) {
    assert.ok(actions.includes(a), `缺少 ${a}`);
  }
  assert.equal(r.json().items[0].actor, 'root');
});

test('cookieOf 辅助函数可用', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const r = await h.app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(cookieOf(r), null);
  assert.equal(r.json().xmaxKeyConfigured, true);
});
