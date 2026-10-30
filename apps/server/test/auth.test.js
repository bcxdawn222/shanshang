import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN, approve, cookieOf, loginAdmin, makeApp, registerMerchant } from './helpers.js';

test('管理员口令登录：正确可进，错误被拒', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());

  const ok = await h.app.inject({ method: 'POST', url: '/api/auth/admin/login', payload: ADMIN });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().account.role, 'admin');
  assert.ok(cookieOf(ok));

  const bad = await h.app.inject({
    method: 'POST',
    url: '/api/auth/admin/login',
    payload: { username: ADMIN.username, password: 'wrong-password' },
  });
  assert.equal(bad.statusCode, 401);
});

test('连续失败 5 次锁定 15 分钟，到时解锁（ACC-01）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const wrong = { username: ADMIN.username, password: 'wrong-password' };

  for (let i = 0; i < 5; i += 1) {
    const r = await h.app.inject({ method: 'POST', url: '/api/auth/admin/login', payload: wrong });
    assert.equal(r.statusCode, 401);
  }
  const locked = await h.app.inject({ method: 'POST', url: '/api/auth/admin/login', payload: ADMIN });
  assert.equal(locked.statusCode, 429, '锁定期间正确口令也不能进');

  h.advance(15 * 60_000 + 1);
  const after = await h.app.inject({ method: 'POST', url: '/api/auth/admin/login', payload: ADMIN });
  assert.equal(after.statusCode, 200);
});

test('商家不能用商家入口登录成管理员，反之亦然', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const m = await registerMerchant(h.app);

  const asAdmin = await h.app.inject({
    method: 'POST',
    url: '/api/auth/admin/login',
    payload: { username: m.username, password: m.password },
  });
  assert.equal(asAdmin.statusCode, 401);

  const asMerchant = await h.app.inject({ method: 'POST', url: '/api/auth/merchant/login', payload: ADMIN });
  assert.equal(asMerchant.statusCode, 401);
});

test('注册后为待审核，只能看资料，不能改资料（ACC-02）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const m = await registerMerchant(h.app);

  const profile = await h.app.inject({ method: 'GET', url: '/api/merchant/profile', headers: { cookie: m.cookie } });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().account.status, 'pending');
  assert.equal(profile.json().account.merchant.slotQuota, 18);

  const edit = await h.app.inject({
    method: 'PUT',
    url: '/api/merchant/profile',
    headers: { cookie: m.cookie },
    payload: { shopLocation: '3F-A12' },
  });
  assert.equal(edit.statusCode, 403);
  assert.equal(edit.json().error.code, 'MERCHANT_NOT_APPROVED');
});

test('用户名重复注册被拒（不区分大小写）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  await registerMerchant(h.app, { username: 'shop01' });
  const dup = await h.app.inject({
    method: 'POST',
    url: '/api/auth/merchant/register',
    payload: { username: 'SHOP01', password: 'another-pass', brandName: '别家' },
  });
  assert.equal(dup.statusCode, 409);
});

test('审核通过后可改昵称和店铺位置，但不能改品牌名', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const m = await registerMerchant(h.app);
  await approve(h.app, admin, m.id);

  const ok = await h.app.inject({
    method: 'PUT',
    url: '/api/merchant/profile',
    headers: { cookie: m.cookie },
    payload: { nickname: '小店', shopLocation: '3F-A12 测试女装' },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().account.merchant.shopLocation, '3F-A12 测试女装');

  const brand = await h.app.inject({
    method: 'PUT',
    url: '/api/merchant/profile',
    headers: { cookie: m.cookie },
    payload: { brandName: '改名' },
  });
  assert.equal(brand.statusCode, 400, '多余字段被 schema 拒绝');
});

test('改密后旧会话全部失效，新会话可用（SET-01）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const m = await registerMerchant(h.app);

  const other = await h.app.inject({
    method: 'POST',
    url: '/api/auth/merchant/login',
    payload: { username: m.username, password: m.password },
  });
  const otherCookie = cookieOf(other);

  const wrongOld = await h.app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { cookie: m.cookie },
    payload: { oldPassword: 'not-it', newPassword: 'new-pass-0001' },
  });
  assert.equal(wrongOld.statusCode, 400);

  const changed = await h.app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { cookie: m.cookie },
    payload: { oldPassword: m.password, newPassword: 'new-pass-0001' },
  });
  assert.equal(changed.statusCode, 200);
  const fresh = cookieOf(changed);

  for (const cookie of [m.cookie, otherCookie]) {
    const r = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(r.statusCode, 401, '旧会话应失效');
  }
  const me = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: fresh } });
  assert.equal(me.statusCode, 200);

  const oldPwd = await h.app.inject({
    method: 'POST',
    url: '/api/auth/merchant/login',
    payload: { username: m.username, password: m.password },
  });
  assert.equal(oldPwd.statusCode, 401);
});

test('会话过期后失效', async (t) => {
  const h = await makeApp({ env: { SESSION_TTL_HOURS: '1' } });
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  h.advance(3600_000 + 1);
  const r = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } });
  assert.equal(r.statusCode, 401);
});

test('退出登录后会话失效', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: admin } });
  const r = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } });
  assert.equal(r.statusCode, 401);
});

test('管理员口令少于 12 位拒绝启动', async () => {
  await assert.rejects(() => makeApp({ env: { ADMIN_PASSWORD: 'short' } }), /至少 12 位/);
});
