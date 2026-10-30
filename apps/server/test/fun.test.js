import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RECOMMEND_OPTIONS, DEFAULT_ZODIAC_WHEEL, ZODIACS as SHARED_ZODIACS } from '../../../packages/shared/src/index.js';
import { ZODIACS } from '../src/lib/fun.js';
import { approve, loginAdmin, makeApp, registerMerchant } from './helpers.js';

const bearer = (token) => ({ authorization: `Bearer ${token}` });
const clone = (v) => JSON.parse(JSON.stringify(v));

async function setup() {
  const h = await makeApp();
  const admin = await loginAdmin(h.app);
  const inject = (method, url, cookie, payload) => h.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload });
  async function device({ bind = true } = {}) {
    const dev = (await h.app.inject({ method: 'POST', url: '/api/device/register' })).json();
    if (bind) await inject('POST', '/api/admin/devices/bind', admin, { code: dev.code, name: '1 号机' });
    return dev;
  }
  const funConfig = (token) => h.app.inject({ method: 'GET', url: '/api/device/fun/config', headers: bearer(token) });
  const auditRows = async () => (await inject('GET', '/api/admin/audit-logs?limit=200', admin)).json().items;
  return { h, admin, inject, device, funConfig, auditRows };
}

test('服务端星座列表与 packages/shared 一致', () => {
  assert.deepEqual(
    ZODIACS.map((z) => [z.key, z.name]),
    SHARED_ZODIACS.map((z) => [z.key, z.name]),
  );
});

test('玩法配置接口：未登录 401、商家 403', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const m = await registerMerchant(s.h.app);
  await approve(s.h.app, s.admin, m.id);
  const routes = [
    ['GET', '/api/admin/fun/zodiac-wheel'],
    ['PUT', '/api/admin/fun/zodiac-wheel'],
    ['POST', '/api/admin/fun/zodiac-wheel/reset'],
    ['GET', '/api/admin/fun/recommend-options'],
    ['PUT', '/api/admin/fun/recommend-options'],
    ['POST', '/api/admin/fun/recommend-options/reset'],
  ];
  for (const [method, url] of routes) {
    assert.equal((await s.inject(method, url, null, {})).statusCode, 401, `${method} ${url} 未登录`);
    assert.equal((await s.inject(method, url, m.cookie, {})).statusCode, 403, `${method} ${url} 商家`);
  }
});

test('设备玩法配置：需设备令牌且已绑定；未配置时全为 null', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  assert.equal((await s.h.app.inject({ method: 'GET', url: '/api/device/fun/config' })).statusCode, 401);
  assert.equal((await s.funConfig('forged')).statusCode, 401);
  const pending = await s.device({ bind: false });
  const r1 = await s.funConfig(pending.token);
  assert.equal(r1.statusCode, 403);
  assert.equal(r1.json().error.code, 'DEVICE_NOT_BOUND');

  const dev = await s.device();
  const r2 = await s.funConfig(dev.token);
  assert.equal(r2.statusCode, 200);
  assert.deepEqual(r2.json(), { zodiacWheel: null, recommendOptions: null, fortuneLibrary: null });

  const g = (await s.inject('GET', '/api/admin/fun/zodiac-wheel', s.admin)).json();
  assert.deepEqual(g, { configured: false, value: null, updatedAt: null });
});

test('星座轮盘：保存共享默认值、设备读到、恢复默认后回落 null，写审计 fun.zodiac', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const dev = await s.device();

  const wheel = clone(DEFAULT_ZODIAC_WHEEL);
  wheel.aries[0] = { label: ' 火焰红 ', color: '红色' };
  const put = await s.inject('PUT', '/api/admin/fun/zodiac-wheel', s.admin, wheel);
  assert.equal(put.statusCode, 200, put.body);
  const saved = put.json();
  assert.equal(saved.configured, true);
  assert.equal(saved.value.aries[0].label, '火焰红');
  assert.equal(typeof saved.updatedAt, 'number');

  const cfg = (await s.funConfig(dev.token)).json();
  assert.deepEqual(cfg.zodiacWheel, saved.value);
  assert.equal(cfg.recommendOptions, null);

  const reset = await s.inject('POST', '/api/admin/fun/zodiac-wheel/reset', s.admin, {});
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().configured, false);
  assert.equal((await s.funConfig(dev.token)).json().zodiacWheel, null);

  const rows = (await s.auditRows()).filter((x) => x.action === 'fun.zodiac');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].detail, { reset: true });
  assert.deepEqual(rows[1].detail, { cells: 96 });
  assert.equal(rows[1].targetType, 'fun_config');
});

test('星座轮盘校验：缺星座、格数越界、名称过长 / 重复、色和风格同时或都不填、未知标签', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const put = (body) => s.inject('PUT', '/api/admin/fun/zodiac-wheel', s.admin, body);
  const base = () => clone(DEFAULT_ZODIAC_WHEEL);

  const cases = [];
  const missing = base();
  delete missing.leo;
  cases.push([missing, 'BAD_REQUEST']);
  const extra = base();
  extra.ophiuchus = base().leo;
  cases.push([extra, 'BAD_REQUEST']);
  const few = base();
  few.leo = few.leo.slice(0, 7);
  cases.push([few, 'BAD_REQUEST']);
  const many = base();
  many.leo = [...many.leo, ...Array.from({ length: 5 }, (_, i) => ({ label: `多${i}`, color: '红色' }))];
  cases.push([many, 'BAD_REQUEST']);
  const longLabel = base();
  longLabel.leo[0].label = '一二三四五六七八九十十一';
  cases.push([longLabel, 'BAD_REQUEST']);
  const blank = base();
  blank.leo[0].label = '   ';
  cases.push([blank, 'BAD_REQUEST']);
  const dup = base();
  dup.leo[1].label = dup.leo[0].label;
  cases.push([dup, 'BAD_REQUEST']);
  const both = base();
  both.leo[0] = { label: '双选', color: '红色', scene: '约会' };
  cases.push([both, 'BAD_REQUEST']);
  const none = base();
  none.leo[0] = { label: '都不选' };
  cases.push([none, 'BAD_REQUEST']);
  const unknownField = base();
  unknownField.leo[0].style = 'x';
  cases.push([unknownField, 'BAD_REQUEST']);
  const unknownTag = base();
  unknownTag.leo[0] = { label: '金属银', color: '银色' };
  cases.push([unknownTag, 'UNKNOWN_TAG']);

  for (const [body, code] of cases) {
    const r = await put(body);
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().error.code, code, r.body);
  }
  assert.equal((await s.inject('GET', '/api/admin/fun/zodiac-wheel', s.admin)).json().configured, false);
  assert.equal((await s.auditRows()).filter((x) => x.action === 'fun.zodiac').length, 0);

  // 12 格上限可保存
  const max = base();
  max.leo = [...max.leo, ...Array.from({ length: 4 }, (_, i) => ({ label: `加${i}`, scene: '约会' }))];
  assert.equal((await put(max)).statusCode, 200);
});

test('AI 推荐选项：增删改整体替换、设备读到、恢复默认，写审计 fun.recommend', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const dev = await s.device();

  const opts = clone(DEFAULT_RECOMMEND_OPTIONS);
  opts.occasions.pop();
  opts.feelings.push({ key: 'sweet', label: '甜美', colors: { 粉色: 2 }, categories: { 连衣裙: 1.5 } });
  const put = await s.inject('PUT', '/api/admin/fun/recommend-options', s.admin, opts);
  assert.equal(put.statusCode, 200, put.body);
  const value = put.json().value;
  assert.equal(value.occasions.length, 7);
  assert.equal(value.feelings.length, 6);
  // 未给的权重组规整为空对象
  assert.deepEqual(value.feelings.at(-1), { key: 'sweet', label: '甜美', scenes: {}, colors: { 粉色: 2 }, categories: { 连衣裙: 1.5 } });
  assert.deepEqual((await s.funConfig(dev.token)).json().recommendOptions, value);

  assert.equal((await s.inject('POST', '/api/admin/fun/recommend-options/reset', s.admin, {})).statusCode, 200);
  assert.equal((await s.funConfig(dev.token)).json().recommendOptions, null);

  const rows = (await s.auditRows()).filter((x) => x.action === 'fun.recommend');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].detail, { occasions: 7, feelings: 6 });
});

test('AI 推荐选项校验：空组、超量、key 格式 / 重复、名称重复、权重越界、未知标签、无权重', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const put = (body) => s.inject('PUT', '/api/admin/fun/recommend-options', s.admin, body);
  const base = () => clone(DEFAULT_RECOMMEND_OPTIONS);
  const opt = (key, extra = {}) => ({ key, label: key, colors: { 红色: 1 }, ...extra });

  const cases = [];
  cases.push([{ ...base(), feelings: [] }, 'BAD_REQUEST']);
  cases.push([{ occasions: base().occasions }, 'BAD_REQUEST']);
  cases.push([{ ...base(), feelings: Array.from({ length: 13 }, (_, i) => opt(`f${i}`)) }, 'BAD_REQUEST']);
  cases.push([{ ...base(), feelings: [opt('Bad-Key')] }, 'BAD_REQUEST']);
  cases.push([{ ...base(), feelings: [opt('a'), opt('a', { label: 'b' })] }, 'BAD_REQUEST']);
  cases.push([{ ...base(), feelings: [opt('a', { label: '同名' }), opt('b', { label: '同名' })] }, 'BAD_REQUEST']);
  cases.push([{ ...base(), feelings: [opt('a', { colors: { 红色: 11 } })] }, 'BAD_REQUEST']);
  cases.push([{ ...base(), feelings: [opt('a', { colors: { 红色: -1 } })] }, 'BAD_REQUEST']);
  cases.push([{ ...base(), feelings: [opt('a', { styles: {} })] }, 'BAD_REQUEST']);
  cases.push([{ ...base(), feelings: [{ key: 'a', label: 'a' }] }, 'BAD_REQUEST']);
  cases.push([{ ...base(), feelings: [opt('a', { scenes: { 蹦迪: 1 } })] }, 'UNKNOWN_TAG']);
  cases.push([{ ...base(), feelings: [opt('a', { categories: { 红色: 1 } })] }, 'UNKNOWN_TAG']);

  for (const [body, code] of cases) {
    const r = await put(body);
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().error.code, code, r.body);
  }
  assert.equal((await s.inject('GET', '/api/admin/fun/recommend-options', s.admin)).json().configured, false);
  assert.equal((await s.auditRows()).filter((x) => x.action === 'fun.recommend').length, 0);
});

test('已停用的字典标签仍可用于玩法配置', async (t) => {
  const s = await setup();
  t.after(() => s.h.close());
  const red = (await s.inject('GET', '/api/admin/dicts', s.admin)).json().items.find((d) => d.kind === 'color' && d.name === '红色');
  assert.equal((await s.inject('PATCH', `/api/admin/dicts/${red.id}`, s.admin, { enabled: false })).statusCode, 200);
  assert.equal((await s.inject('PUT', '/api/admin/fun/zodiac-wheel', s.admin, clone(DEFAULT_ZODIAC_WHEEL))).statusCode, 200);
});
