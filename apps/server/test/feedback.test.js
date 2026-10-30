import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approve, loginAdmin, makeApp, registerMerchant } from './helpers.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);

/** 手工拼 multipart；files: [{ field, data }] */
function multipart(files = []) {
  const boundary = '----shanshangFeedbackBoundary';
  const parts = [];
  for (const f of files) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
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
  const inject = (method, url, cookie, payload) => h.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload });
  async function merchant(username, brandName, { approveNow = true } = {}) {
    const m = await registerMerchant(h.app, { username, password: `${username}-pass-01`, brandName });
    if (approveNow) await approve(h.app, admin, m.id);
    return m;
  }
  const uploadQr = (kind, data, cookie = admin) => {
    const body = multipart(data ? [{ field: 'image', data }] : []);
    return h.app.inject({ method: 'POST', url: `/api/admin/site-extras/qr?kind=${kind}`, headers: { cookie, ...body.headers }, payload: body.payload });
  };
  const auditActions = async () => (await inject('GET', '/api/admin/audit-logs?limit=200', admin)).json().items.map((x) => x.action);
  return { h, admin, inject, merchant, uploadQr, auditActions };
}

test('留言反馈：商家提交、只看自己；管理员列表、回复、改回复；写审计', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m1 = await s.merchant('shop01', '测试女装');
  const m2 = await s.merchant('shop02', '隔壁男装');
  // 待审核商家也能留言
  const pending = await s.merchant('shop03', '待审小店', { approveNow: false });

  const post = (m, content) => s.inject('POST', '/api/merchant/feedback', m.cookie, { content });
  const r = await post(m1, '  设备 2 号机黑屏  ');
  assert.equal(r.statusCode, 201, r.body);
  const item = r.json().item;
  assert.equal(item.content, '设备 2 号机黑屏');
  assert.equal(item.status, 'pending');
  assert.equal(item.reply, '');
  assert.equal((await post(m2, '想加格位')).statusCode, 201);
  assert.equal((await post(pending, '审核多久')).statusCode, 201);

  // 校验：空、纯空白、超长、多余字段
  assert.equal((await post(m1, '')).statusCode, 400);
  assert.equal((await post(m1, '   ')).statusCode, 400);
  assert.equal((await post(m1, 'x'.repeat(501))).statusCode, 400);
  assert.equal((await s.inject('POST', '/api/merchant/feedback', m1.cookie, { content: 'a', merchantId: m2.id })).statusCode, 400);

  // 商家只看自己
  const mine = (await s.inject('GET', '/api/merchant/feedback', m1.cookie)).json();
  assert.equal(mine.total, 1);
  assert.equal(mine.items[0].id, item.id);
  assert.equal(mine.items[0].brandName, undefined, '商家视图不含品牌名、用户名');

  // 管理员列表：待处理在前、带品牌名、pending 计数，可按状态 / 商家筛选
  const all = (await s.inject('GET', '/api/admin/feedback', s.admin)).json();
  assert.equal(all.total, 3);
  assert.equal(all.pending, 3);
  assert.ok(all.items.every((x) => x.status === 'pending'));
  assert.equal(all.items.find((x) => x.id === item.id).brandName, '测试女装');
  assert.equal((await s.inject('GET', `/api/admin/feedback?merchantId=${m2.id}`, s.admin)).json().total, 1);

  // 回复
  const reply = (id, text) => s.inject('POST', `/api/admin/feedback/${id}/reply`, s.admin, { reply: text });
  const rep = await reply(item.id, '已安排上门检修');
  assert.equal(rep.statusCode, 200, rep.body);
  assert.equal(rep.json().item.status, 'replied');
  assert.equal(rep.json().item.reply, '已安排上门检修');
  assert.ok(rep.json().item.repliedAt);
  assert.equal((await reply(item.id, '   ')).statusCode, 400);
  assert.equal((await reply(99999, '不存在')).statusCode, 404);
  // 改回复
  assert.equal((await reply(item.id, '明天上午上门')).json().item.reply, '明天上午上门');

  // 商家能看到回复
  const after = (await s.inject('GET', '/api/merchant/feedback', m1.cookie)).json().items[0];
  assert.equal(after.status, 'replied');
  assert.equal(after.reply, '明天上午上门');

  const filtered = (await s.inject('GET', '/api/admin/feedback?status=replied', s.admin)).json();
  assert.equal(filtered.total, 1);
  assert.equal(filtered.pending, 2);
  // 待处理排在已回复前面
  const order = (await s.inject('GET', '/api/admin/feedback', s.admin)).json().items.map((x) => x.status);
  assert.deepEqual(order, ['pending', 'pending', 'replied']);

  const actions = await s.auditActions();
  assert.equal(actions.filter((a) => a === 'feedback.create').length, 3);
  assert.equal(actions.filter((a) => a === 'feedback.reply').length, 2);
});

test('留言限流：每个商家每小时 20 条', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m = await s.merchant('shop01', '测试女装');
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await s.inject('POST', '/api/merchant/feedback', m.cookie, { content: `第 ${i} 条` })).statusCode, 201);
  }
  const limited = await s.inject('POST', '/api/merchant/feedback', m.cookie, { content: '超了' });
  assert.equal(limited.statusCode, 429);
  s.h.advance(60 * 60_000);
  assert.equal((await s.inject('POST', '/api/merchant/feedback', m.cookie, { content: '一小时后' })).statusCode, 201);
});

test('站点信息：管理员配置联系方式、二维码、打赏码；商家只读', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m = await s.merchant('shop01', '测试女装');
  const pending = await s.merchant('shop02', '待审小店', { approveNow: false });

  const empty = { contactPhone: '', contactAddress: '', wechatQrUrl: '', tipQrUrl: '' };
  assert.deepEqual((await s.inject('GET', '/api/admin/site-extras', s.admin)).json(), empty);
  assert.deepEqual((await s.inject('GET', '/api/merchant/contact', m.cookie)).json(), { phone: '', address: '', wechatQrUrl: '' });

  const put = (payload) => s.inject('PUT', '/api/admin/site-extras', s.admin, payload);
  const saved = await put({ contactPhone: ' 400-000-0000 ', contactAddress: '某某商场 3F 运营部' });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().contactPhone, '400-000-0000');
  // 校验：空对象、多余字段、非法地址
  assert.equal((await put({})).statusCode, 400);
  assert.equal((await put({ foo: 'x' })).statusCode, 400);
  assert.equal((await put({ tipQrUrl: 'javascript:alert(1)' })).statusCode, 400);
  assert.equal((await put({ tipQrUrl: 'https://example.com/tip.png' })).statusCode, 200);

  // 上传微信二维码与打赏码
  const wq = await s.uploadQr('wechat', JPEG);
  assert.equal(wq.statusCode, 200, wq.body);
  assert.match(wq.json().wechatQrUrl, /^media\/site\/[a-f0-9]{24}\.jpg$/);
  const tq = await s.uploadQr('tip', PNG);
  assert.match(tq.json().tipQrUrl, /^media\/site\/[a-f0-9]{24}\.png$/);
  const file = await s.h.app.inject({ method: 'GET', url: `/api/${tq.json().tipQrUrl}` });
  assert.equal(file.statusCode, 200);
  assert.ok(file.rawPayload.equals(PNG));

  // 更换后旧图删除
  const oldKey = wq.json().wechatQrUrl.slice('media/'.length);
  assert.ok(await s.h.storage.exists(oldKey));
  const wq2 = await s.uploadQr('wechat', PNG);
  assert.notEqual(wq2.json().wechatQrUrl, wq.json().wechatQrUrl);
  assert.equal(await s.h.storage.exists(oldKey), false);

  // 非法上传
  assert.equal((await s.uploadQr('wechat', Buffer.from('not an image'))).statusCode, 400);
  assert.equal((await s.uploadQr('wechat', null)).statusCode, 400);
  assert.equal((await s.uploadQr('other', JPEG)).statusCode, 400);
  assert.equal((await s.inject('POST', '/api/admin/site-extras/qr?kind=tip', s.admin, {})).statusCode, 400);

  // 商家读取
  const contact = (await s.inject('GET', '/api/merchant/contact', m.cookie)).json();
  assert.deepEqual(contact, { phone: '400-000-0000', address: '某某商场 3F 运营部', wechatQrUrl: wq2.json().wechatQrUrl });
  assert.deepEqual((await s.inject('GET', '/api/merchant/tip', m.cookie)).json(), { qrUrl: tq.json().tipQrUrl });
  // 待审核商家能看联系我们，不能看打赏码
  assert.equal((await s.inject('GET', '/api/merchant/contact', pending.cookie)).statusCode, 200);
  assert.equal((await s.inject('GET', '/api/merchant/tip', pending.cookie)).statusCode, 403);

  // 2 次成功 PUT + 3 次成功上传
  assert.equal((await s.auditActions()).filter((a) => a === 'site.update').length, 5);
});

test('权限：商家不能调总后台接口，管理员不能调商家接口，未登录 401', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m = await s.merchant('shop01', '测试女装');

  const adminRoutes = [
    ['GET', '/api/admin/feedback'],
    ['POST', '/api/admin/feedback/1/reply'],
    ['GET', '/api/admin/site-extras'],
    ['PUT', '/api/admin/site-extras'],
    ['POST', '/api/admin/site-extras/qr?kind=tip'],
  ];
  for (const [method, url] of adminRoutes) {
    assert.equal((await s.h.app.inject({ method, url, payload: {} })).statusCode, 401, `${method} ${url} 未登录`);
    assert.equal((await s.inject(method, url, m.cookie, {})).statusCode, 403, `${method} ${url} 商家`);
  }
  const merchantRoutes = [
    ['GET', '/api/merchant/feedback'],
    ['POST', '/api/merchant/feedback'],
    ['GET', '/api/merchant/contact'],
    ['GET', '/api/merchant/tip'],
  ];
  for (const [method, url] of merchantRoutes) {
    assert.equal((await s.h.app.inject({ method, url, payload: {} })).statusCode, 401, `${method} ${url} 未登录`);
    assert.equal((await s.inject(method, url, s.admin, {})).statusCode, 403, `${method} ${url} 管理员`);
  }
});
