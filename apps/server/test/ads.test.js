import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approve, loginAdmin, makeApp, registerMerchant } from './helpers.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(500, 3)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(500, 4)]);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
// 测试里调小上限，避免构造 200MB 请求
const LIMITS = { image: 1024, video: 4096 };
const bearer = (token) => ({ authorization: `Bearer ${token}` });

/** 手工拼 multipart；files: [{ field, data, filename, type }] */
function multipart(fields, files = []) {
  const boundary = '----shanshangAdsBoundary';
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename ?? 'a.bin'}"\r\nContent-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      f.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function setup() {
  const h = await makeApp({ uploadLimits: LIMITS });
  let admin = await loginAdmin(h.app);
  const m = await registerMerchant(h.app);
  await approve(h.app, admin, m.id);
  const d = (await h.app.inject({ method: 'GET', url: '/api/dicts' })).json();
  const inject = (method, url, cookie, payload) => h.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload });
  await inject('POST', `/api/admin/merchants/${m.id}/points`, admin, { type: 'add', amount: 100, note: '测试充值' });

  const form = (method, url, fields, files, cookie = admin) => {
    const body = multipart(fields, files);
    return h.app.inject({ method, url, headers: { cookie, ...body.headers }, payload: body.payload });
  };
  const uploadAsset = (data, name = '素材', cookie = admin) => form('POST', '/api/admin/ads/assets', { name }, data ? [{ field: 'file', data }] : [], cookie);

  async function garment(title = '测试连衣裙', { approveNow = true } = {}) {
    const r = await form(
      'POST',
      '/api/merchant/garments',
      { title, gender: 'female', setType: 'single', categoryId: d.category[0].id, colorId: d.color[0].id },
      [{ field: 'image', data: JPEG, filename: 'a.jpg', type: 'image/jpeg' }],
      m.cookie,
    );
    assert.equal(r.statusCode, 201, r.body);
    const id = r.json().garment.id;
    if (approveNow) await inject('POST', `/api/admin/garments/${id}/approve`, admin, {});
    return id;
  }

  async function device({ bind = true } = {}) {
    const dev = (await h.app.inject({ method: 'POST', url: '/api/device/register' })).json();
    if (bind) dev.id = (await inject('POST', '/api/admin/devices/bind', admin, { code: dev.code, name: '1 号机' })).json().device.id;
    return dev;
  }
  const dget = (token, path) => h.app.inject({ method: 'GET', url: `/api/device/${path}`, headers: bearer(token) });
  let sess = 0;
  const tryon = async (token, garmentId, times) => {
    sess += 1;
    const segments = Array.from({ length: times }, (_, seq) => ({ seq, garmentId, durationMs: 1000 }));
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/device/tryon/segments',
      headers: bearer(token),
      payload: { sessionId: `sess-${String(sess).padStart(6, '0')}`, segments },
    });
    assert.equal(r.statusCode, 200, r.body);
  };
  const auditActions = async () => (await inject('GET', '/api/admin/audit-logs?limit=200', admin)).json().items.map((x) => x.action);

  const out = { h, admin, m, inject, form, uploadAsset, garment, device, dget, tryon, auditActions };
  // 拨动时钟超过会话有效期（7 天）后重新登录管理员
  out.relogin = async () => {
    admin = await loginAdmin(h.app);
    out.admin = admin;
  };
  return out;
}

test('素材上传：按文件头识别图片 / mp4 / webm，写审计，可公开读取', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());

  const cases = [
    [JPEG, 'image', /\.jpg$/],
    [PNG, 'image', /\.png$/],
    [MP4, 'video', /\.mp4$/],
    [WEBM, 'video', /\.webm$/],
  ];
  for (const [data, type, ext] of cases) {
    const r = await s.uploadAsset(data, `素材-${type}`);
    assert.equal(r.statusCode, 201, r.body);
    const item = r.json().item;
    assert.equal(item.type, type);
    assert.equal(item.sizeBytes, data.length);
    assert.match(item.url, /^media\/ads\/[a-f0-9]{24}\./);
    assert.match(item.url, ext);
    const file = await s.h.app.inject({ method: 'GET', url: `/api/${item.url}` });
    assert.equal(file.statusCode, 200);
    assert.ok(file.rawPayload.equals(data));
  }
  const mp4 = await s.h.app.inject({ method: 'GET', url: `/api/${(await s.inject('GET', '/api/admin/ads/assets', s.admin)).json().items.find((x) => x.url.endsWith('.mp4')).url}` });
  assert.equal(mp4.headers['content-type'], 'video/mp4');

  const list = (await s.inject('GET', '/api/admin/ads/assets', s.admin)).json().items;
  assert.equal(list.length, 4);
  assert.deepEqual(Object.keys(list[0]).sort(), ['createdAt', 'id', 'name', 'sizeBytes', 'type', 'url']);
  assert.equal((await s.auditActions()).filter((a) => a === 'ad.upload').length, 4);

  // name 放在文件后面也接受
  const late = await s.h.app.inject({
    method: 'POST',
    url: '/api/admin/ads/assets',
    ...(() => {
      const b = multipart({}, [{ field: 'file', data: JPEG }]);
      const tail = Buffer.from('--' + '----shanshangAdsBoundary' + '\r\nContent-Disposition: form-data; name="name"\r\n\r\n后置名称\r\n------shanshangAdsBoundary--\r\n');
      const payload = Buffer.concat([b.payload.subarray(0, b.payload.length - '------shanshangAdsBoundary--\r\n'.length), tail]);
      return { payload, headers: { cookie: s.admin, ...b.headers } };
    })(),
  });
  assert.equal(late.statusCode, 201, late.body);
  assert.equal(late.json().item.name, '后置名称');
});

test('素材上传：非法类型、缺文件、缺名称、超限被拒，且不留文件', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const fs = await import('node:fs');
  const adsFiles = () => {
    try {
      return fs.readdirSync(`${s.h.mediaDir}/ads`).length;
    } catch {
      return 0;
    }
  };

  const bad = await s.uploadAsset(Buffer.from('<html>not media</html>'));
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, 'UNSUPPORTED_MEDIA');
  assert.equal((await s.uploadAsset(null)).statusCode, 400);
  assert.equal((await s.uploadAsset(JPEG, '')).statusCode, 400);
  assert.equal((await s.uploadAsset(JPEG, 'x'.repeat(61))).statusCode, 400);
  const notForm = await s.inject('POST', '/api/admin/ads/assets', s.admin, { name: 'x' });
  assert.equal(notForm.statusCode, 400);

  // 图片上限 1KB（测试值），视频 4KB；视频可超过图片上限
  const bigImage = await s.uploadAsset(Buffer.concat([JPEG, Buffer.alloc(LIMITS.image)]));
  assert.equal(bigImage.statusCode, 413);
  assert.equal(bigImage.json().error.code, 'FILE_TOO_LARGE');
  const okVideo = await s.uploadAsset(Buffer.concat([MP4, Buffer.alloc(2000)]));
  assert.equal(okVideo.statusCode, 201, '视频 2.5KB 未超视频上限');
  const bigVideo = await s.uploadAsset(Buffer.concat([MP4, Buffer.alloc(LIMITS.video)]));
  assert.equal(bigVideo.statusCode, 413);

  assert.equal(s.h.db.prepare('SELECT COUNT(*) FROM ad_asset').pluck().get(), 1);
  assert.equal(adsFiles(), 1, '被拒的上传不留半截文件');
});

test('其他上传仍按 10MB 全局上限（视频上限只在素材路由放宽）', async (t) => {
  const h = await makeApp();
  t.after(() => h.close());
  const admin = await loginAdmin(h.app);
  const body = multipart({}, [{ field: 'image', data: Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024 + 1)]) }]);
  const r = await h.app.inject({ method: 'POST', url: '/api/admin/points/recharge-qr', headers: { cookie: admin, ...body.headers }, payload: body.payload });
  assert.equal(r.statusCode, 413);
});

test('删除素材：被播放列表引用时 409 ASSET_IN_USE；未引用时删除记录和文件', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const a = (await s.uploadAsset(JPEG, 'A')).json().item;
  const b = (await s.uploadAsset(MP4, 'B')).json().item;
  const dev = await s.device();
  assert.equal((await s.inject('PUT', `/api/admin/playlists/${dev.id}`, s.admin, { items: [{ assetId: a.id, seconds: 5 }] })).statusCode, 200);

  const inUse = await s.inject('DELETE', `/api/admin/ads/assets/${a.id}`, s.admin);
  assert.equal(inUse.statusCode, 409);
  assert.equal(inUse.json().error.code, 'ASSET_IN_USE');
  assert.equal((await s.h.app.inject({ method: 'GET', url: `/api/${a.url}` })).statusCode, 200, '文件仍在');

  const ok = await s.inject('DELETE', `/api/admin/ads/assets/${b.id}`, s.admin);
  assert.equal(ok.statusCode, 200);
  assert.equal((await s.h.app.inject({ method: 'GET', url: `/api/${b.url}` })).statusCode, 404, '文件已删');
  assert.equal((await s.inject('DELETE', `/api/admin/ads/assets/${b.id}`, s.admin)).statusCode, 404);
  assert.ok((await s.auditActions()).includes('ad.delete'));

  // 从播放列表移除后可删
  await s.inject('PUT', `/api/admin/playlists/${dev.id}`, s.admin, { items: [] });
  assert.equal((await s.inject('DELETE', `/api/admin/ads/assets/${a.id}`, s.admin)).statusCode, 200);
});

test('播放列表：默认列表与按设备；空列表回退默认；视频忽略 seconds；version 随内容变化', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const img = (await s.uploadAsset(JPEG, '图')).json().item;
  const vid = (await s.uploadAsset(WEBM, '视频')).json().item;
  const d1 = await s.device();
  const d2 = await s.device();

  const empty = (await s.dget(d1.token, 'playlist')).json();
  assert.deepEqual(empty.items, []);
  assert.match(empty.version, /^[a-f0-9]{16}$/);

  const def = await s.inject('PUT', '/api/admin/playlists/default', s.admin, { items: [{ assetId: img.id }, { assetId: vid.id, seconds: 999 }] });
  assert.equal(def.statusCode, 200, def.body);
  assert.deepEqual(def.json(), {
    deviceId: 'default',
    configured: true,
    items: [
      { assetId: img.id, seconds: 8 },
      { assetId: vid.id, seconds: 8 },
    ],
  });
  const p1 = (await s.dget(d1.token, 'playlist')).json();
  assert.deepEqual(p1.items, [
    { assetId: img.id, type: 'image', url: img.url, seconds: 8 },
    { assetId: vid.id, type: 'video', url: vid.url, seconds: 8 },
  ]);
  assert.notEqual(p1.version, empty.version);
  assert.equal((await s.dget(d1.token, 'playlist')).json().version, p1.version, '内容不变 version 不变');

  // d2 单独配置
  const g2 = await s.inject('GET', `/api/admin/playlists/${d2.id}`, s.admin);
  assert.deepEqual(g2.json(), { deviceId: d2.id, configured: false, items: [] });
  await s.inject('PUT', `/api/admin/playlists/${d2.id}`, s.admin, { items: [{ assetId: vid.id }, { assetId: img.id, seconds: 30 }] });
  assert.equal((await s.inject('GET', `/api/admin/playlists/${d2.id}`, s.admin)).json().configured, true);
  const p2 = (await s.dget(d2.token, 'playlist')).json();
  assert.deepEqual(p2.items.map((i) => [i.assetId, i.seconds]), [[vid.id, 8], [img.id, 30]]);
  assert.notEqual(p2.version, p1.version);
  assert.equal((await s.dget(d1.token, 'playlist')).json().version, p1.version, 'd1 仍用默认列表');

  // 只改秒数也会改变 version
  await s.inject('PUT', `/api/admin/playlists/${d2.id}`, s.admin, { items: [{ assetId: vid.id }, { assetId: img.id, seconds: 31 }] });
  assert.notEqual((await s.dget(d2.token, 'playlist')).json().version, p2.version);

  // 空列表 = 回退默认
  await s.inject('PUT', `/api/admin/playlists/${d2.id}`, s.admin, { items: [] });
  assert.equal((await s.dget(d2.token, 'playlist')).json().version, p1.version);

  // 校验
  const put = (id, items) => s.inject('PUT', `/api/admin/playlists/${id}`, s.admin, { items });
  assert.equal((await put('default', [{ assetId: img.id, seconds: 0 }])).statusCode, 400);
  assert.equal((await put('default', [{ assetId: img.id, seconds: 121 }])).statusCode, 400);
  assert.equal((await put('default', [{ assetId: img.id, seconds: 2.5 }])).statusCode, 400);
  assert.equal((await put('default', [{ assetId: 9999 }])).statusCode, 400);
  assert.equal((await put('default', Array.from({ length: 101 }, () => ({ assetId: img.id })))).statusCode, 400);
  assert.equal((await put('default', Array.from({ length: 100 }, () => ({ assetId: img.id })))).statusCode, 200);
  assert.equal((await put('9999', [])).statusCode, 404);
  assert.equal((await put('abc', [])).statusCode, 400);
  assert.ok((await s.auditActions()).includes('playlist.update'));
});

test('媒体 Range：206 / 后缀范围 / 416；无 Range 返回整份', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const v = (await s.uploadAsset(MP4)).json().item;
  const get = (range) => s.h.app.inject({ method: 'GET', url: `/api/${v.url}`, headers: range ? { range } : {} });

  const full = await get();
  assert.equal(full.statusCode, 200);
  assert.equal(full.headers['accept-ranges'], 'bytes');
  assert.equal(Number(full.headers['content-length']), MP4.length);

  const part = await get('bytes=0-9');
  assert.equal(part.statusCode, 206);
  assert.equal(part.headers['content-range'], `bytes 0-9/${MP4.length}`);
  assert.equal(part.headers['content-type'], 'video/mp4');
  assert.ok(part.rawPayload.equals(MP4.subarray(0, 10)));

  const open = await get('bytes=100-');
  assert.equal(open.statusCode, 206);
  assert.ok(open.rawPayload.equals(MP4.subarray(100)));

  const suffix = await get('bytes=-5');
  assert.equal(suffix.statusCode, 206);
  assert.ok(suffix.rawPayload.equals(MP4.subarray(-5)));

  const beyond = await get(`bytes=${MP4.length}-`);
  assert.equal(beyond.statusCode, 416);
  assert.equal(beyond.headers['content-range'], `bytes */${MP4.length}`);

  assert.equal((await get('bytes=0-1,5-6')).statusCode, 200, '多段按整份返回');
  assert.equal((await s.h.app.inject({ method: 'GET', url: '/api/media/ads/000000000000000000000000.mp4' })).statusCode, 404);
  assert.equal((await s.h.app.inject({ method: 'GET', url: '/api/media/other/000000000000000000000000.mp4' })).statusCode, 400);
});

test('热门榜：近 7 天试穿条数排序；置顶 / 取消 / 移出 / 恢复；只含设备可见服饰', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const a = await s.garment('A');
  const b = await s.garment('B');
  const c = await s.garment('C');
  const dev = await s.device();
  const hot = async () => (await s.dget(dev.token, 'hot')).json().items;

  assert.deepEqual(await hot(), []);
  await s.tryon(dev.token, a, 1);
  await s.tryon(dev.token, b, 3);
  s.h.advance(8 * DAY);
  await s.relogin();
  await s.tryon(dev.token, c, 2);
  await s.tryon(dev.token, a, 1);
  // 8 天前的 b 已过期：c=2, a=1
  let items = await hot();
  assert.deepEqual(items.map((x) => [x.title, x.tryonCount]), [['C', 2], ['A', 1]]);
  assert.equal(items[0].brandName, '测试女装');
  assert.ok('imagePath' in items[0] && 'xmaxUrl' in items[0]);

  const act = (id, action) => s.inject('POST', `/api/admin/hot/${id}`, s.admin, { action });
  assert.equal((await act(b, 'pin')).statusCode, 200);
  assert.equal((await act(a, 'pin')).statusCode, 200);
  items = await hot();
  assert.deepEqual(items.map((x) => x.title), ['B', 'A', 'C'], '置顶按置顶先后排最前，0 次的置顶也进榜');

  await act(b, 'unpin');
  await act(c, 'remove');
  assert.deepEqual((await hot()).map((x) => x.title), ['A']);
  const admin = (await s.inject('GET', '/api/admin/hot', s.admin)).json().items;
  const byId = new Map(admin.map((x) => [x.garmentId, x]));
  assert.equal(byId.get(c).removed, true, '后台含被移出的');
  assert.equal(admin[admin.length - 1].garmentId, c, '移出的排最后');
  assert.equal(byId.get(a).pinned, true);
  assert.deepEqual(Object.keys(byId.get(a)).filter((k) => ['garmentId', 'title', 'brandName', 'tryonCount', 'pinned', 'removed'].includes(k)).length, 6);

  await act(c, 'restore');
  assert.deepEqual((await hot()).map((x) => x.title), ['A', 'C']);

  // 不可见（下架）的服饰不进设备榜
  await s.inject('POST', `/api/admin/garments/${a}/offline`, s.admin, {});
  assert.deepEqual((await hot()).map((x) => x.title), ['C']);

  assert.equal((await act(a, 'bad')).statusCode, 400);
  assert.equal((await act(9999, 'pin')).statusCode, 404);
  const actions = await s.auditActions();
  for (const x of ['hot.pin', 'hot.unpin', 'hot.remove', 'hot.restore']) assert.ok(actions.includes(x), x);
});

test('热门榜最多 20 条', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const dev = await s.device();
  // 默认 18 格，加一次格（+5）才能放下 22 件
  assert.equal((await s.inject('POST', `/api/admin/merchants/${s.m.id}/add-slots`, s.admin, {})).statusCode, 200);
  for (let i = 0; i < 22; i += 1) await s.tryon(dev.token, await s.garment(`G${i}`), 1);
  assert.equal((await s.dget(dev.token, 'hot')).json().items.length, 20);
});

test('短剧专题：新建 / 修改 / 删除；设备只见启用专题和可见服饰', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const a = await s.garment('A');
  const b = await s.garment('B');
  const hidden = await s.garment('审核中', { approveNow: false });
  const dev = await s.device();
  const poster = (data = JPEG) => [{ field: 'poster', data, filename: 'p.jpg', type: 'image/jpeg' }];
  const create = (fields, files = poster()) => s.form('POST', '/api/admin/dramas', fields, files);

  assert.equal((await create({ title: '繁花', garmentIds: JSON.stringify([a]) }, [])).statusCode, 400, '缺海报');
  assert.equal((await create({ title: '', garmentIds: JSON.stringify([a]) })).statusCode, 400);
  assert.equal((await create({ title: '繁花', garmentIds: 'not json' })).statusCode, 400);
  assert.equal((await create({ title: '繁花', garmentIds: JSON.stringify([9999]) })).statusCode, 400);
  assert.equal((await create({ title: '繁花', garmentIds: '[]', enabled: 'yes' })).statusCode, 400);
  assert.equal((await create({ title: '繁花', garmentIds: '[]' }, poster(Buffer.from('nope')))).statusCode, 400);

  const r1 = await create({ title: '繁花', garmentIds: JSON.stringify([b, hidden, a]), sort: '2', enabled: 'true' });
  assert.equal(r1.statusCode, 201, r1.body);
  const d1 = r1.json().item;
  assert.match(d1.posterUrl, /^media\/dramas\/[a-f0-9]{24}\.jpg$/);
  assert.deepEqual(
    { title: d1.title, garmentIds: d1.garmentIds, sort: d1.sort, enabled: d1.enabled },
    { title: '繁花', garmentIds: [b, hidden, a], sort: 2, enabled: true },
  );
  const d2 = (await create({ title: '停用的', garmentIds: JSON.stringify([a]), sort: '1', enabled: 'false' })).json().item;
  const d3 = (await create({ title: '狂飙', garmentIds: JSON.stringify([a]), sort: '0' })).json().item;

  const admin = (await s.inject('GET', '/api/admin/dramas', s.admin)).json().items;
  assert.deepEqual(admin.map((x) => x.title), ['狂飙', '停用的', '繁花'], '按 sort 排序，含停用');

  const devList = async () => (await s.dget(dev.token, 'dramas')).json().items;
  let items = await devList();
  assert.deepEqual(items.map((x) => x.title), ['狂飙', '繁花']);
  assert.deepEqual(items[1], { id: d1.id, title: '繁花', posterUrl: d1.posterUrl, garmentIds: [b, a] }, '只保留可见服饰，保持顺序');

  // 修改：换海报，旧海报删除
  const patch = await s.form('PATCH', `/api/admin/dramas/${d1.id}`, { title: '繁花（新）', enabled: 'false' }, poster(PNG));
  assert.equal(patch.statusCode, 200, patch.body);
  const p = patch.json().item;
  assert.equal(p.title, '繁花（新）');
  assert.equal(p.enabled, false);
  assert.deepEqual(p.garmentIds, [b, hidden, a], '未传的字段不变');
  assert.match(p.posterUrl, /\.png$/);
  assert.equal((await s.h.app.inject({ method: 'GET', url: `/api/${d1.posterUrl}` })).statusCode, 404, '旧海报已删');
  assert.equal((await s.h.app.inject({ method: 'GET', url: `/api/${p.posterUrl}` })).statusCode, 200);
  assert.deepEqual((await devList()).map((x) => x.title), ['狂飙']);

  await s.form('PATCH', `/api/admin/dramas/${d2.id}`, { enabled: 'true' }, []);
  assert.deepEqual((await devList()).map((x) => x.title), ['狂飙', '停用的']);
  assert.equal((await s.form('PATCH', `/api/admin/dramas/${d2.id}`, {}, [])).statusCode, 400, '没有修改内容');
  assert.equal((await s.form('PATCH', '/api/admin/dramas/9999', { title: 'x' }, [])).statusCode, 404);

  // 删除：海报文件一起删
  assert.equal((await s.inject('DELETE', `/api/admin/dramas/${d3.id}`, s.admin)).statusCode, 200);
  assert.equal((await s.h.app.inject({ method: 'GET', url: `/api/${d3.posterUrl}` })).statusCode, 404);
  assert.equal((await s.inject('DELETE', `/api/admin/dramas/${d3.id}`, s.admin)).statusCode, 404);
  assert.deepEqual((await devList()).map((x) => x.title), ['停用的']);

  const actions = await s.auditActions();
  for (const x of ['drama.create', 'drama.update', 'drama.delete']) assert.ok(actions.includes(x), x);
});

test('idleMinutes：默认 4，校验 1~60，设备 config 返回', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const dev = await s.device();
  assert.equal((await s.inject('GET', '/api/admin/points/config', s.admin)).json().idleMinutes, 4);
  assert.equal((await s.dget(dev.token, 'config')).json().idleMinutes, 4);
  for (const bad of [0, 61, 2.5, 'x']) {
    assert.equal((await s.inject('PUT', '/api/admin/points/config', s.admin, { idleMinutes: bad })).statusCode, 400, String(bad));
  }
  const ok = await s.inject('PUT', '/api/admin/points/config', s.admin, { idleMinutes: 60 });
  assert.equal(ok.json().idleMinutes, 60);
  const cfg = (await s.dget(dev.token, 'config')).json();
  assert.equal(cfg.idleMinutes, 60);
  assert.equal(cfg.tryonMaxMinutes, 5);
});

test('权限：管理接口未登录 401、商家 403；设备接口无凭证 401、未绑定 403', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const routes = [
    ['GET', '/api/admin/ads/assets'],
    ['POST', '/api/admin/ads/assets'],
    ['DELETE', '/api/admin/ads/assets/1'],
    ['GET', '/api/admin/playlists/default'],
    ['PUT', '/api/admin/playlists/default'],
    ['GET', '/api/admin/hot'],
    ['POST', '/api/admin/hot/1'],
    ['GET', '/api/admin/dramas'],
    ['POST', '/api/admin/dramas'],
    ['PATCH', '/api/admin/dramas/1'],
    ['DELETE', '/api/admin/dramas/1'],
  ];
  for (const [method, url] of routes) {
    assert.equal((await s.h.app.inject({ method, url, payload: {} })).statusCode, 401, `${method} ${url} 未登录`);
    assert.equal((await s.h.app.inject({ method, url, headers: { cookie: s.m.cookie }, payload: {} })).statusCode, 403, `${method} ${url} 商家`);
  }
  // 商家上传素材被拒，且不落盘
  assert.equal((await s.uploadAsset(JPEG, 'x', s.m.cookie)).statusCode, 403);
  assert.equal(s.h.db.prepare('SELECT COUNT(*) FROM ad_asset').pluck().get(), 0);

  const pending = await s.device({ bind: false });
  for (const path of ['playlist', 'hot', 'dramas', 'config']) {
    assert.equal((await s.h.app.inject({ method: 'GET', url: `/api/device/${path}` })).statusCode, 401, path);
    const r = await s.dget(pending.token, path);
    assert.equal(r.statusCode, 403, path);
    assert.equal(r.json().error.code, 'DEVICE_NOT_BOUND');
  }
});
