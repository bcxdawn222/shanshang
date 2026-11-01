import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approve, loginAdmin, makeApp, registerMerchant } from './helpers.js';

// 最小的合法 JPEG 头（服务端按文件头识别类型）
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const MIN = 60_000;

/** 手工拼 multipart，避免依赖 inject 对 FormData 的支持 */
function multipart(fields, file) {
  const boundary = '----shanshangTestBoundary';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${file.name ?? 'a.jpg'}"\r\nContent-Type: ${file.type ?? 'image/jpeg'}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function dicts(app) {
  const d = (await app.inject({ method: 'GET', url: '/api/dicts' })).json();
  return { category: d.category[0].id, color: d.color[0].id, scene: d.scene[0].id, sceneList: d.scene };
}

async function setup(opts) {
  const h = await makeApp(opts);
  const admin = await loginAdmin(h.app);
  const m = await registerMerchant(h.app);
  await approve(h.app, admin, m.id);
  // Phase 3 起余额低于隐藏阈值（默认 5）的商家服饰不进设备清单，这里先充值，让本文件专注服饰流程
  const topUp = await h.app.inject({
    method: 'POST',
    url: `/api/admin/merchants/${m.id}/points`,
    headers: { cookie: admin },
    payload: { type: 'add', amount: 100, note: '测试充值' },
  });
  if (topUp.statusCode !== 200) throw new Error(`top up failed: ${topUp.body}`);
  const d = await dicts(h.app);
  const upload = (overrides = {}, file = { data: JPEG }, cookie = m.cookie) => {
    const body = multipart(
      { title: '测试连衣裙', gender: 'female', setType: 'single', categoryId: d.category, colorId: d.color, ...overrides },
      file,
    );
    return h.app.inject({ method: 'POST', url: '/api/merchant/garments', headers: { cookie, ...body.headers }, payload: body.payload });
  };
  return { h, admin, m, d, upload };
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });

async function boundDevice(h, admin) {
  const d = (await h.app.inject({ method: 'POST', url: '/api/device/register' })).json();
  await h.app.inject({
    method: 'POST',
    url: '/api/admin/devices/bind',
    headers: { cookie: admin },
    payload: { code: d.code, name: '1 号机' },
  });
  return d.token;
}

test('上传：进入审核期，50~70 分钟后上架；原图可公开读取（GAR-04、GAR-07）', async (t) => {
  const { h, upload } = await setup();
  t.after(() => h.close());
  const r = await upload({ sceneIds: '' });
  assert.equal(r.statusCode, 201, r.body);
  const g = r.json().garment;
  assert.equal(g.status, 'reviewing');
  assert.equal(g.xmaxReady, false, '假 Xmax 不返回 STS，转存失败但不阻断上传');
  const delay = g.availableAt - g.createdAt;
  assert.ok(delay >= 50 * MIN && delay <= 70 * MIN, `审核期 ${delay / MIN} 分钟`);
  assert.deepEqual(r.json().slots, { quota: 18, used: 1 });

  const img = await h.app.inject({ method: 'GET', url: `/api/${g.imagePath}` });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/jpeg');
  assert.ok(img.rawPayload.equals(JPEG));
});

test('必填标签缺失、字典项无效、非图片文件被拒', async (t) => {
  const { h, upload, d } = await setup();
  t.after(() => h.close());
  assert.equal((await upload({ title: '' })).statusCode, 400);
  assert.equal((await upload({ gender: 'x' })).statusCode, 400);
  assert.equal((await upload({ categoryId: d.color })).statusCode, 400, '主色 id 不能当品类');
  assert.equal((await upload({ sceneIds: '99999' })).statusCode, 400);
  assert.equal((await upload({}, { data: Buffer.from('<?php echo 1;') , type: 'image/jpeg' })).statusCode, 400);
  assert.equal((await upload({}, null)).statusCode, 400);
  const list = (await h.app.inject({ method: 'GET', url: '/api/merchant/garments', headers: { cookie: (await registerMerchant(h.app, { username: 'shop99' })).cookie } })).statusCode;
  assert.equal(list, 403, '未审核商家不能访问服饰接口');
});

test('停用的字典项不能再选；管理员可新增字典项', async (t) => {
  const { h, admin, upload, d } = await setup();
  t.after(() => h.close());
  const off = await h.app.inject({ method: 'PATCH', url: `/api/admin/dicts/${d.category}`, headers: { cookie: admin }, payload: { enabled: false } });
  assert.equal(off.statusCode, 200);
  assert.equal((await upload()).statusCode, 400);

  const add = await h.app.inject({ method: 'POST', url: '/api/admin/dicts', headers: { cookie: admin }, payload: { kind: 'category', name: '卫衣' } });
  assert.equal(add.statusCode, 201);
  assert.equal((await upload({ categoryId: add.json().item.id })).statusCode, 201);
  const dup = await h.app.inject({ method: 'POST', url: '/api/admin/dicts', headers: { cookie: admin }, payload: { kind: 'category', name: '卫衣' } });
  assert.equal(dup.statusCode, 409);
});

test('满 18 格拒绝上传并提示联系管理员；管理员加格 +5（GAR-01~03）', async (t) => {
  const { h, admin, m, upload } = await setup();
  t.after(() => h.close());
  for (let i = 0; i < 18; i += 1) assert.equal((await upload()).statusCode, 201);
  const full = await upload();
  assert.equal(full.statusCode, 409);
  assert.equal(full.json().error.code, 'SLOT_FULL');
  assert.equal(full.json().error.message, '服饰格位已用完，请联系管理员');

  const add = await h.app.inject({ method: 'POST', url: `/api/admin/merchants/${m.id}/add-slots`, headers: { cookie: admin } });
  assert.deepEqual(add.json().slots, { quota: 23, used: 18 });
  assert.equal((await upload()).statusCode, 201);

  const denied = await h.app.inject({ method: 'POST', url: `/api/admin/merchants/${m.id}/add-slots`, headers: { cookie: m.cookie } });
  assert.equal(denied.statusCode, 403, '商家不能给自己加格');
});

test('删除释放格位，原图同时删除', async (t) => {
  const { h, m, upload } = await setup();
  t.after(() => h.close());
  const g = (await upload()).json().garment;
  const del = await h.app.inject({ method: 'DELETE', url: `/api/merchant/garments/${g.id}`, headers: { cookie: m.cookie } });
  assert.equal(del.statusCode, 200);
  assert.equal(del.json().slots.used, 0);
  assert.equal((await h.app.inject({ method: 'GET', url: `/api/${g.imagePath}` })).statusCode, 404);
});

test('商家只能操作自己的服饰', async (t) => {
  const { h, admin, upload } = await setup();
  t.after(() => h.close());
  const g = (await upload()).json().garment;
  const other = await registerMerchant(h.app, { username: 'shop02', brandName: '别家' });
  await approve(h.app, admin, other.id);
  for (const [method, url] of [
    ['POST', `/api/merchant/garments/${g.id}/offline`],
    ['DELETE', `/api/merchant/garments/${g.id}`],
  ]) {
    assert.equal((await h.app.inject({ method, url, headers: { cookie: other.cookie } })).statusCode, 404);
  }
  const list = await h.app.inject({ method: 'GET', url: '/api/merchant/garments', headers: { cookie: other.cookie } });
  assert.equal(list.json().items.length, 0);
});

test('设备只拿到审核期已到的服饰；到时自动上架（GAR-07）', async (t) => {
  const { h, admin, upload } = await setup();
  t.after(() => h.close());
  const token = await boundDevice(h, admin);
  const g = (await upload()).json().garment;
  const list = () => h.app.inject({ method: 'GET', url: '/api/device/garments', headers: bearer(token) });

  assert.equal((await list()).json().items.length, 0, '审核期内设备看不到');
  h.advance(49 * MIN);
  assert.equal((await list()).json().items.length, 0, '50 分钟前一定看不到');
  h.advance(22 * MIN);
  const items = (await list()).json().items;
  assert.equal(items.length, 1, '70 分钟后一定上架');
  assert.equal(items[0].id, g.id);
  assert.equal(items[0].brandName, '测试女装');
  assert.equal(items[0].category, '连衣裙');
});

test('管理员提前通过立即上架；驳回后设备看不到，商家能看到原因', async (t) => {
  const { h, admin, m, upload } = await setup();
  t.after(() => h.close());
  const token = await boundDevice(h, admin);
  const a = (await upload({ title: 'A' })).json().garment;
  const b = (await upload({ title: 'B' })).json().garment;

  const ok = await h.app.inject({ method: 'POST', url: `/api/admin/garments/${a.id}/approve`, headers: { cookie: admin }, payload: {} });
  assert.equal(ok.json().garment.status, 'ready');
  assert.equal((await h.app.inject({ method: 'POST', url: `/api/admin/garments/${b.id}/reject`, headers: { cookie: admin }, payload: { note: '' } })).statusCode, 400, '驳回要填原因');
  const no = await h.app.inject({ method: 'POST', url: `/api/admin/garments/${b.id}/reject`, headers: { cookie: admin }, payload: { note: '图片模糊' } });
  assert.equal(no.json().garment.status, 'rejected');

  h.advance(3 * 60 * MIN);
  const items = (await h.app.inject({ method: 'GET', url: '/api/device/garments', headers: bearer(token) })).json().items;
  assert.deepEqual(items.map((x) => x.title), ['A'], '驳回的到时也不会自动上架');

  const mine = (await h.app.inject({ method: 'GET', url: '/api/merchant/garments', headers: { cookie: m.cookie } })).json().items;
  assert.equal(mine.find((x) => x.id === b.id).reviewNote, '图片模糊');

  const deny = await h.app.inject({ method: 'POST', url: `/api/admin/garments/${a.id}/approve`, headers: { cookie: m.cookie }, payload: {} });
  assert.equal(deny.statusCode, 403, '商家不能审核');
});

test('商家下架可自己恢复；平台下架只能管理员恢复', async (t) => {
  const { h, admin, m, upload } = await setup();
  t.after(() => h.close());
  const g = (await upload()).json().garment;
  const act = (who, action) =>
    h.app.inject({ method: 'POST', url: `/api/${who === admin ? 'admin' : 'merchant'}/garments/${g.id}/${action}`, headers: { cookie: who }, payload: {} });

  assert.equal((await act(m.cookie, 'offline')).json().garment.status, 'offline');
  assert.equal((await act(m.cookie, 'online')).json().garment.status, 'reviewing', '审核期未到回到审核期');

  assert.equal((await act(admin, 'offline')).json().garment.offlineBy, 'admin');
  const locked = await act(m.cookie, 'online');
  assert.equal(locked.statusCode, 403);
  assert.equal(locked.json().error.code, 'GARMENT_LOCKED');
  assert.equal((await act(admin, 'approve')).json().garment.status, 'ready');
});

test('商家被停用后，其服饰从设备清单消失（ACC-07）', async (t) => {
  const { h, admin, m, upload } = await setup();
  t.after(() => h.close());
  const token = await boundDevice(h, admin);
  const g = (await upload()).json().garment;
  await h.app.inject({ method: 'POST', url: `/api/admin/garments/${g.id}/approve`, headers: { cookie: admin }, payload: {} });
  const list = async () => (await h.app.inject({ method: 'GET', url: '/api/device/garments', headers: bearer(token) })).json().items.length;
  assert.equal(await list(), 1);
  await h.app.inject({ method: 'POST', url: `/api/admin/merchants/${m.id}/disable`, headers: { cookie: admin } });
  assert.equal(await list(), 0);
});

test('未绑定设备拿不到服饰清单', async (t) => {
  const { h } = await setup();
  t.after(() => h.close());
  const d = (await h.app.inject({ method: 'POST', url: '/api/device/register' })).json();
  const r = await h.app.inject({ method: 'GET', url: '/api/device/garments', headers: bearer(d.token) });
  assert.equal(r.statusCode, 403);
});

test('Xmax 转存成功时记下地址；请求只带永久密钥到 Xmax、带临时凭证到 COS', async (t) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/cos/sts')) {
      return Response.json({
        code: 200,
        data: {
          credentials: { accessKeyId: 'AKID', secretAccessKey: 'SK', sessionToken: 'ST' },
          prefix: 'open/resource/user/u1/',
          bucket: 'bkt-1',
          region: 'ap-nanjing',
        },
      });
    }
    return new Response('', { status: 200 });
  };
  const { h, upload } = await setup({ fetchImpl });
  t.after(() => h.close());
  const g = (await upload()).json().garment;
  assert.equal(g.xmaxReady, true);

  const sts = calls.find((c) => c.url.endsWith('/cos/sts'));
  assert.equal(sts.init.headers['X-Api-Key'], 'test-permanent-key');
  const put = calls.find((c) => c.init?.method === 'PUT');
  assert.match(put.url, /^https:\/\/bkt-1\.cos\.ap-nanjing\.myqcloud\.com\/open\/resource\/user\/u1\/\d+_[a-f0-9]{12}\.jpg$/);
  assert.match(put.init.headers.Authorization, /^q-sign-algorithm=sha1&q-ak=AKID&/);
  assert.equal(put.init.headers['x-cos-security-token'], 'ST');
  assert.ok(!JSON.stringify(put.init.headers).includes('test-permanent-key'), 'COS 请求不带永久密钥');

  const stored = h.db.prepare('SELECT xmax_url FROM garment WHERE id = ?').pluck().get(g.id);
  assert.equal(stored, put.url);
});

test('超过 10MB 的图片被拒', async (t) => {
  const { h, upload } = await setup();
  t.after(() => h.close());
  const big = Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024 + 1)]);
  const r = await upload({}, { data: big });
  assert.equal(r.statusCode, 413);
  assert.equal(h.db.prepare('SELECT COUNT(*) FROM garment').pluck().get(), 0);
});
