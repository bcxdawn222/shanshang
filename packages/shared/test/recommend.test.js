import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RECOMMEND_OPTIONS, matchWheel, mergeWeights, recommend, seededRng, similarity } from '../src/index.js';

const COLORS = ['黑色', '白色', '红色', '粉色', '米色', '蓝色'];
const CATEGORIES = ['连衣裙', 'T恤', '外套', '衬衫'];
const SCENES = ['约会', '通勤', '闺蜜', '宴会', '面试', '运动'];

/** 构造服饰：merchants 个商家，每家 perMerchant 件，女装为主、少量男装 */
function makeGarments(merchants = 5, perMerchant = 6) {
  const out = [];
  let id = 1;
  for (let m = 1; m <= merchants; m += 1) {
    for (let i = 0; i < perMerchant; i += 1) {
      out.push({
        id,
        merchantId: m,
        category: CATEGORIES[(id + m) % CATEGORIES.length],
        color: COLORS[(id * 7 + m) % COLORS.length],
        scenes: [SCENES[id % SCENES.length], SCENES[(id + 2) % SCENES.length]],
        gender: i === perMerchant - 1 ? 'male' : 'female',
      });
      id += 1;
    }
  }
  return out;
}

const date = DEFAULT_RECOMMEND_OPTIONS.occasions.find((o) => o.label === '约会局');
const gentle = DEFAULT_RECOMMEND_OPTIONS.feelings.find((o) => o.label === '温柔');
const weights = mergeWeights(date, gentle);

test('默认选项齐全，权重可合并', () => {
  assert.deepEqual(
    DEFAULT_RECOMMEND_OPTIONS.occasions.map((o) => o.label),
    ['约会局', '闺蜜局', '见家长', '面试', '生日派对', '旅行拍照', '通勤', '运动'],
  );
  assert.deepEqual(DEFAULT_RECOMMEND_OPTIONS.feelings.map((o) => o.label), ['温柔', '酷飒', '高级', '元气', '松弛']);
  assert.equal(weights.scenes['约会'], 3.5);
  assert.equal(weights.colors['粉色'], 3);
});

test('相似度为三项命中比例', () => {
  const a = { merchantId: 1, category: 'T恤', color: '黑色' };
  assert.equal(similarity(a, a), 1);
  assert.equal(similarity(a, { merchantId: 2, category: 'T恤', color: '白色' }), 1 / 3);
  assert.equal(similarity(a, { merchantId: 2, category: '外套', color: '白色' }), 0);
});

test('同种子结果确定', () => {
  const g = makeGarments();
  const a = recommend(g, { gender: 'female', weights, rng: seededRng('s1') });
  const b = recommend(g, { gender: 'female', weights, rng: seededRng('s1') });
  assert.deepEqual(a, b);
  assert.equal(a.items.length, 6);
});

test('性别过滤', () => {
  const g = makeGarments();
  const male = recommend(g, { gender: 'male', weights, rng: seededRng('m'), count: 10 });
  assert.equal(male.items.length, 5);
  assert.ok(male.items.every((x) => x.gender === 'male'));
  const kid = recommend(g, { gender: 'kid', weights, rng: seededRng('k') });
  assert.deepEqual(kid, { items: [], exhausted: true });
});

test('多商家时前 N 件商家不重复', () => {
  const g = makeGarments(5, 6);
  for (const seed of ['a', 'b', 'c', 'd']) {
    const { items } = recommend(g, { gender: 'female', weights, rng: seededRng(seed), count: 5 });
    assert.equal(new Set(items.map((x) => x.merchantId)).size, 5, seed);
  }
  // 商家数少于 count 时，前“商家数”件仍然分散
  const { items } = recommend(makeGarments(3, 6), { gender: 'female', weights, rng: seededRng('x'), count: 6 });
  assert.equal(new Set(items.slice(0, 3).map((x) => x.merchantId)).size, 3);
});

test('高分标签优先：命中约会/粉色的服饰排进结果', () => {
  const g = [
    { id: 1, merchantId: 1, category: 'T恤', color: '黑色', scenes: ['运动'], gender: 'female' },
    { id: 2, merchantId: 1, category: '连衣裙', color: '粉色', scenes: ['约会'], gender: 'female' },
    { id: 3, merchantId: 2, category: '外套', color: '灰色', scenes: ['通勤'], gender: 'female' },
    { id: 4, merchantId: 2, category: '连衣裙', color: '米色', scenes: ['约会'], gender: 'female' },
  ];
  const { items } = recommend(g, { gender: 'female', weights, rng: seededRng('t'), count: 2 });
  assert.deepEqual(new Set(items.map((x) => x.id)), new Set([2, 4]));
});

test('exclude 排除已推荐，耗尽时 exhausted', () => {
  const g = makeGarments(3, 4).filter((x) => x.gender === 'female');
  const exclude = new Set();
  const seen = [];
  for (let round = 0; round < 10; round += 1) {
    const r = recommend(g, { gender: 'female', weights, rng: seededRng('e', round), count: 4, exclude });
    if (r.exhausted) break;
    for (const x of r.items) {
      assert.ok(!exclude.has(x.id));
      exclude.add(x.id);
      seen.push(x.id);
    }
  }
  assert.equal(seen.length, g.length);
  assert.equal(new Set(seen).size, g.length);
  assert.deepEqual(recommend(g, { gender: 'female', weights, exclude }), { items: [], exhausted: true });
});

test('轮盘按幸运色匹配', () => {
  const g = makeGarments();
  const items = matchWheel(g, { label: '温柔粉', color: '粉色' }, { gender: 'female', rng: seededRng('w'), count: 3 });
  assert.equal(items.length, 3);
  assert.ok(items.every((x) => x.color === '粉色' && x.gender === 'female'));
});

test('轮盘按风格匹配，不足时补齐并去重', () => {
  const g = [
    { id: 1, merchantId: 1, category: 'T恤', color: '黑色', scenes: ['宴会'], gender: 'female' },
    { id: 2, merchantId: 2, category: '外套', color: '白色', scenes: ['通勤'], gender: 'female' },
    { id: 3, merchantId: 3, category: '衬衫', color: '灰色', scenes: ['休闲'], gender: 'female' },
    { id: 4, merchantId: 1, category: '连衣裙', color: '红色', scenes: ['运动'], gender: 'female' },
    { id: 5, merchantId: 2, category: '外套', color: '黑色', scenes: ['宴会'], gender: 'male' },
  ];
  const items = matchWheel(g, { label: '宴会风', scene: '宴会' }, { gender: 'female', rng: seededRng('f'), count: 6 });
  assert.equal(items[0].id, 1);
  assert.equal(items.length, 4);
  assert.equal(new Set(items.map((x) => x.id)).size, 4);
  assert.ok(items.every((x) => x.gender === 'female'));
  // count 下限 3
  assert.equal(matchWheel(g, { label: '宴会风', scene: '宴会' }, { gender: 'female', count: 1 }).length, 3);
});
