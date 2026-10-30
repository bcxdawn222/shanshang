import assert from 'node:assert/strict';
import { test } from 'node:test';
import { purgeExpiredSnapshots } from '../src/lib/snapshots.js';
import { approve, cookieOf, loginAdmin, makeApp, registerMerchant } from './helpers.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const bearer = (token) => ({ authorization: `Bearer ${token}` });

/** 手工拼 multipart；files: [{ field, data, filename, type }] */
function multipart(fields, files = []) {
  const boundary = '----shanshangSnapBoundary';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename ?? 'a.jpg'}"\r\nContent-Type: ${f.type ?? 'image/jpeg'}\r\n\r\n`,
      ),
      f.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function setup({ env = {} } = {}) {
  // 快照图片上限调小到 1KB，方便测超限
  const h = await makeApp({ env, uploadLimits: { image: 10 * 1024 * 1024, video: 10 * 1024 * 1024, snapshot: 1024 } });
  const admin = await loginAdmin(h.app);
  const d = (await h.app.inject({ method: 'GET', url: '/api/dicts' })).json();
  const inject = (method, url, cookie, payload) => h.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload });

  async function merchant(username, brandName) {
    const m = await registerMerchant(h.app, { username, password: `${username}-pass-01`, brandName });
    await approve(h.app, admin, m.id);
    await inject('POST', `/api/admin/merchants/${m.id}/points`, admin, { type: 'add', amount: 100, note: '测试充值' });
    m.relogin = async () => {
      const r = await h.app.inject({ method: 'POST', url: '/api/auth/merchant/login', payload: { username, password: m.password } });
      assert.equal(r.statusCode, 200, r.body);
      m.cookie = cookieOf(r);
    };
    return m;
  }

  async function garment(m, title = '测试连衣裙') {
    const body = multipart(
      { title, gender: 'female', setType: 'single', categoryId: d.category[0].id, colorId: d.color[0].id, discountText: '凭码 8 折', shopLocation: '3F-301' },
      [{ field: 'image', data: JPEG }],
    );
    const r = await h.app.inject({ method: 'POST', url: '/api/merchant/garments', headers: { cookie: m.cookie, ...body.headers }, payload: body.payload });
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().garment.id;
    await inject('POST', `/api/admin/garments/${id}/approve`, admin, {});
    return id;
  }

  async function device({ bind = true } = {}) {
    const dev = (await h.app.inject({ method: 'POST', url: '/api/device/register' })).json();
    if (bind) await inject('POST', '/api/admin/devices/bind', admin, { code: dev.code, name: '1 号机' });
    return dev;
  }

  const reserve = (dev, garmentId) =>
    h.app.inject({ method: 'POST', url: '/api/device/snapshots', headers: bearer(dev.token), payload: { garmentId } });
  const upload = (dev, id, data = JPEG) => {
    const body = multipart({}, [{ field: 'image', data }]);
    return h.app.inject({ method: 'PUT', url: `/api/device/snapshots/${id}/image`, headers: { ...bearer(dev.token), ...body.headers }, payload: body.payload });
  };
  const lookup = (m, payload) => inject('POST', '/api/merchant/redeem/lookup', m.cookie, payload);
  const redeem = (m, payload) => inject('POST', '/api/merchant/redeem', m.cookie, payload);
  const tokenOf = (url) => url.split('/s/')[1];

  const m1 = await merchant('shop01', '测试女装');
  return { h, admin, inject, merchant, garment, device, reserve, upload, lookup, redeem, tokenOf, m1 };
}

test('快照主流程：预约→上传→快照页→lookup→核销→重复 409→跨商家 404→总后台列表', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const gid = await s.garment(s.m1);
  const dev = await s.device();

  const r = await s.reserve(dev, gid);
  assert.equal(r.statusCode, 201, r.body);
  const snap = r.json();
  assert.match(snap.code, /^\d{6}$/);
  assert.match(snap.url, /^http:\/\/localhost(:\d+)?\/s\/[A-Za-z0-9_-]{43}$/);
  assert.ok(snap.qrSvg.startsWith('<svg'));
  assert.doesNotMatch(snap.qrSvg, /href|<image|<script|url\(/i);
  assert.equal(snap.expiresAt - s.h.db.prepare('SELECT created_at FROM snapshot WHERE id = ?').pluck().get(snap.id), 7 * DAY);
  const token = s.tokenOf(snap.url);

  // 未上传时不可核销、页面显示生成中
  assert.equal((await s.lookup(s.m1, { code: snap.code })).json().state, 'expired');
  assert.equal((await s.redeem(s.m1, { code: snap.code })).statusCode, 410);

  const up = await s.upload(dev, snap.id);
  assert.equal(up.statusCode, 200, up.body);
  // 重复上传 409
  const again = await s.upload(dev, snap.id);
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'SNAPSHOT_IMAGE_EXISTS');

  const pageRes = await s.h.app.inject({ method: 'GET', url: `/s/${token}` });
  assert.equal(pageRes.statusCode, 200);
  assert.match(pageRes.headers['content-type'], /text\/html/);
  assert.equal(pageRes.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(pageRes.headers['cache-control'], 'no-store');
  assert.match(pageRes.body, /<meta name="robots" content="noindex,nofollow">/);
  assert.ok(pageRes.body.includes(snap.code));
  assert.ok(pageRes.body.includes('长按保存图片'));
  assert.ok(pageRes.body.includes('3F-301'));
  assert.ok(pageRes.body.includes(`/admin/#/merchant/redeem?token=${token}`));

  const img = await s.h.app.inject({ method: 'GET', url: `/s/${token}/image` });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['cache-control'], 'private, max-age=3600');
  assert.ok(img.rawPayload.equals(JPEG));

  const lk = await s.lookup(s.m1, { code: snap.code });
  assert.equal(lk.statusCode, 200, lk.body);
  const view = lk.json();
  assert.deepEqual(Object.keys(view).sort(), ['code', 'createdAt', 'expiresAt', 'garmentTitle', 'id', 'imageUrl', 'redeemedAt', 'state']);
  assert.equal(view.state, 'valid');
  assert.equal(view.imageUrl, `/s/${token}/image`);
  assert.equal((await s.lookup(s.m1, { token })).json().id, snap.id);

  // 跨商家：短码和令牌都 404
  const m2 = await s.merchant('shop02', '别家男装');
  for (const body of [{ code: snap.code }, { token }]) {
    const x = await s.lookup(m2, body);
    assert.equal(x.statusCode, 404);
    assert.equal(x.json().error.code, 'SNAPSHOT_NOT_FOUND');
    assert.equal((await s.redeem(m2, body)).statusCode, 404);
  }

  // 参数校验：二选一
  assert.equal((await s.lookup(s.m1, { code: snap.code, token })).statusCode, 400);
  assert.equal((await s.lookup(s.m1, {})).statusCode, 400);
  assert.equal((await s.lookup(s.m1, { code: '12345' })).statusCode, 400);

  const ok = await s.redeem(s.m1, { code: snap.code });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().state, 'redeemed');
  assert.ok(ok.json().redeemedAt);
  const dup = await s.redeem(s.m1, { token });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error.code, 'SNAPSHOT_REDEEMED');

  const audits = (await s.inject('GET', '/api/admin/audit-logs?limit=200', s.admin)).json().items;
  assert.equal(audits.filter((a) => a.action === 'snapshot.redeem').length, 1);

  const rec = (await s.inject('GET', '/api/merchant/redemptions?page=1&pageSize=20', s.m1.cookie)).json();
  assert.equal(rec.total, 1);
  assert.deepEqual(Object.keys(rec.items[0]).sort(), ['code', 'createdAt', 'garmentTitle', 'id', 'redeemedAt']);
  assert.equal((await s.inject('GET', '/api/merchant/redemptions', m2.cookie)).json().total, 0);

  const list = await s.inject('GET', `/api/admin/snapshots?merchantId=${s.m1.id}&state=redeemed`, s.admin);
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().total, 1);
  assert.deepEqual(Object.keys(list.json().items[0]).sort(), [
    'brandName', 'code', 'createdAt', 'deviceId', 'deviceName', 'expiresAt', 'garmentId', 'garmentTitle',
    'hasImage', 'id', 'merchantId', 'purgedAt', 'redeemedAt', 'state',
  ]);
  assert.equal(list.json().items[0].deviceName, '1 号机');
  assert.equal((await s.inject('GET', '/api/admin/snapshots?state=valid', s.admin)).json().total, 0);
  assert.equal((await s.inject('GET', '/api/admin/snapshots?pageSize=101', s.admin)).statusCode, 400);
  assert.equal((await s.inject('GET', '/api/admin/snapshots', s.m1.cookie)).statusCode, 403);

  // 未知令牌 404
  assert.equal((await s.h.app.inject({ method: 'GET', url: '/s/AAAAAAAAAAAAAAAAAAAAAAAA' })).statusCode, 404);
  assert.equal((await s.h.app.inject({ method: 'GET', url: '/s/AAAAAAAAAAAAAAAAAAAAAAAA/image' })).statusCode, 404);
});

test('7 天过期：核销 410、页面显示已过期、清理删除图片', async (t) => {
  const s = await setup({ env: { PUBLIC_BASE_URL: 'https://example.com/sl/' } });
  t.after(() => s.h.close());
  const gid = await s.garment(s.m1);
  const dev = await s.device();
  const snap = (await s.reserve(dev, gid)).json();
  assert.match(snap.url, /^https:\/\/example\.com\/sl\/s\//);
  const token = s.tokenOf(snap.url);
  assert.equal((await s.upload(dev, snap.id)).statusCode, 200);
  assert.equal((await s.lookup(s.m1, { token })).json().imageUrl, `/sl/s/${token}/image`);
  const pageBefore = await s.h.app.inject({ method: 'GET', url: `/s/${token}` });
  assert.ok(pageBefore.body.includes(`https://example.com/sl/admin/#/merchant/redeem?token=${token}`));

  const key = s.h.db.prepare('SELECT image_key FROM snapshot WHERE id = ?').pluck().get(snap.id);
  assert.ok(await s.h.storage.exists(key));

  s.h.advance(7 * DAY + 1);
  await s.m1.relogin();
  const r = await s.redeem(s.m1, { code: snap.code });
  assert.equal(r.statusCode, 410);
  assert.equal(r.json().error.code, 'SNAPSHOT_EXPIRED');
  const lk = (await s.lookup(s.m1, { token })).json();
  assert.equal(lk.state, 'expired');
  assert.equal(lk.imageUrl, '');
  const pageRes = await s.h.app.inject({ method: 'GET', url: `/s/${token}` });
  assert.equal(pageRes.statusCode, 200);
  assert.ok(pageRes.body.includes('已过期'));
  assert.ok(!pageRes.body.includes(snap.code));
  // 清理前也按过期判断
  assert.equal((await s.h.app.inject({ method: 'GET', url: `/s/${token}/image` })).statusCode, 404);

  const now = () => Date.UTC(2026, 9, 30, 8, 0, 0) + 7 * DAY + 1;
  const res = await purgeExpiredSnapshots({ db: s.h.db, storage: s.h.storage, now });
  assert.equal(res.purged, 1);
  assert.equal(await s.h.storage.exists(key), false);
  assert.ok(s.h.db.prepare('SELECT purged_at FROM snapshot WHERE id = ?').pluck().get(snap.id));
  assert.equal((await purgeExpiredSnapshots({ db: s.h.db, storage: s.h.storage, now })).purged, 0);
  const admin = await loginAdmin(s.h.app);
  const item = (await s.inject('GET', '/api/admin/snapshots?state=expired', admin)).json().items[0];
  assert.equal(item.id, snap.id);
  assert.ok(item.purgedAt);
});

test('10 分钟未上传作废；上传校验：本设备、类型、大小', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const gid = await s.garment(s.m1);
  const dev = await s.device();
  const other = await s.device();

  const snap = (await s.reserve(dev, gid)).json();
  // 别的设备不能传
  assert.equal((await s.upload(other, snap.id)).statusCode, 404);
  // 非图片 / 超限
  assert.equal((await s.upload(dev, snap.id, Buffer.from('not an image'))).statusCode, 400);
  const big = await s.upload(dev, snap.id, Buffer.concat([JPEG, Buffer.alloc(2048)]));
  assert.equal(big.statusCode, 413);
  assert.equal(s.h.db.prepare('SELECT image_key FROM snapshot WHERE id = ?').pluck().get(snap.id), null);

  s.h.advance(10 * MIN);
  const late = await s.upload(dev, snap.id);
  assert.equal(late.statusCode, 410);
  assert.equal(late.json().error.code, 'SNAPSHOT_EXPIRED');
  assert.equal((await s.lookup(s.m1, { code: snap.code })).json().state, 'expired');
  assert.equal((await s.redeem(s.m1, { code: snap.code })).statusCode, 410);
  const token = s.tokenOf(snap.url);
  assert.ok((await s.h.app.inject({ method: 'GET', url: `/s/${token}` })).body.includes('已过期'));

  // 作废快照也会被清理标记
  const res = await purgeExpiredSnapshots({ db: s.h.db, storage: s.h.storage, now: () => Date.UTC(2026, 9, 30, 8, 10, 0) });
  assert.equal(res.purged, 1);
});

test('限流：设备预约每分钟 10 次，商家查询 / 核销每分钟 20 次', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const gid = await s.garment(s.m1);
  const dev = await s.device();
  for (let i = 0; i < 10; i += 1) assert.equal((await s.reserve(dev, gid)).statusCode, 201);
  const limited = await s.reserve(dev, gid);
  assert.equal(limited.statusCode, 429);
  assert.match(limited.json().error.message, /频繁/);
  s.h.advance(MIN);
  assert.equal((await s.reserve(dev, gid)).statusCode, 201);

  for (let i = 0; i < 10; i += 1) await s.lookup(s.m1, { code: '000000' });
  for (let i = 0; i < 10; i += 1) await s.redeem(s.m1, { code: '000000' });
  const x = await s.lookup(s.m1, { code: '000000' });
  assert.equal(x.statusCode, 429);
  assert.match(x.json().error.message, /频繁/);
});

test('权限：未登录 401、设备未绑定 403、服饰不可见 404', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const gid = await s.garment(s.m1);
  const pending = await s.device({ bind: false });

  assert.equal((await s.inject('POST', '/api/merchant/redeem/lookup', null, { code: '123456' })).statusCode, 401);
  assert.equal((await s.inject('POST', '/api/merchant/redeem', null, { code: '123456' })).statusCode, 401);
  assert.equal((await s.inject('GET', '/api/merchant/redemptions', null)).statusCode, 401);
  assert.equal((await s.inject('GET', '/api/admin/snapshots', null)).statusCode, 401);
  assert.equal((await s.h.app.inject({ method: 'POST', url: '/api/device/snapshots', payload: { garmentId: gid } })).statusCode, 401);
  const r = await s.reserve(pending, gid);
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().error.code, 'DEVICE_NOT_BOUND');

  // 待审核商家不能核销
  const p = await registerMerchant(s.h.app, { username: 'shop09', password: 'shop-pass-09', brandName: '待审' });
  assert.equal((await s.inject('POST', '/api/merchant/redeem/lookup', p.cookie, { code: '123456' })).statusCode, 403);

  const dev = await s.device();
  assert.equal((await s.reserve(dev, 99999)).statusCode, 404);
  // 下架后不可见
  await s.inject('POST', `/api/merchant/garments/${gid}/offline`, s.m1.cookie, {});
  const visible = (await s.h.app.inject({ method: 'GET', url: '/api/device/garments', headers: bearer(dev.token) })).json().items;
  if (!visible.some((g) => g.id === gid)) assert.equal((await s.reserve(dev, gid)).statusCode, 404);
});

test('快照页 HTML 转义：服饰名含 <script> 不原样输出', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const gid = await s.garment(s.m1, '<script>alert(1)</script>');
  const dev = await s.device();
  const snap = (await s.reserve(dev, gid)).json();
  assert.equal((await s.upload(dev, snap.id)).statusCode, 200);
  const res = await s.h.app.inject({ method: 'GET', url: `/s/${s.tokenOf(snap.url)}` });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'));
  assert.ok(res.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});
