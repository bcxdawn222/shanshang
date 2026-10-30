import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ZODIAC_WHEEL, ZODIACS, cyrb53, mulberry32, pickWheelIndex, seededRng, zodiacOf } from '../src/index.js';

const COLORS = ['黑色', '白色', '灰色', '米色', '棕色', '红色', '粉色', '橙色', '黄色', '绿色', '蓝色', '紫色'];
const SCENES = ['宴会', '约会', '闺蜜', '通勤', '休闲', '运动', '见家长', '面试', '生日派对', '旅行拍照'];

test('cyrb53 / mulberry32 确定性', () => {
  assert.equal(cyrb53('abc'), cyrb53('abc'));
  assert.notEqual(cyrb53('abc'), cyrb53('abd'));
  assert.notEqual(cyrb53('abc', 1), cyrb53('abc'));
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i += 1) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
  const r1 = seededRng('2026-10-30', '03-21', 'fortune');
  const r2 = seededRng('2026-10-30', '03-21', 'fortune');
  assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()]);
});

test('星座边界', () => {
  assert.equal(zodiacOf(1, 19).key, 'capricorn');
  assert.equal(zodiacOf(1, 20).key, 'aquarius');
  assert.equal(zodiacOf(12, 21).key, 'sagittarius');
  assert.equal(zodiacOf(12, 22).key, 'capricorn');
  assert.equal(zodiacOf(12, 31).key, 'capricorn');
  assert.equal(zodiacOf(2, 29).key, 'pisces');
  assert.equal(zodiacOf(3, 21).name, '白羊座');
});

test('每一天都恰好落在一个星座', () => {
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const counts = new Map();
  days.forEach((n, i) => {
    for (let d = 1; d <= n; d += 1) {
      const k = zodiacOf(i + 1, d).key;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  });
  assert.equal(counts.size, 12);
});

test('非法日期抛错', () => {
  for (const [m, d] of [[2, 30], [4, 31], [13, 1], [0, 1], [1, 0], [1.5, 1], ['1', 1]]) {
    assert.throws(() => zodiacOf(m, d), RangeError);
  }
});

test('默认轮盘：每星座 8 格，颜色/场景取自字典', () => {
  for (const z of ZODIACS) {
    const cells = DEFAULT_ZODIAC_WHEEL[z.key];
    assert.equal(cells.length, 8, z.key);
    for (const cell of cells) {
      assert.ok(cell.label);
      assert.ok(cell.color || cell.scene);
      if (cell.color) assert.ok(COLORS.includes(cell.color), cell.color);
      if (cell.scene) assert.ok(SCENES.includes(cell.scene), cell.scene);
    }
  }
});

test('pickWheelIndex 范围与确定性', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 200; i += 1) {
    const idx = pickWheelIndex(rng, 8);
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < 8);
  }
  assert.equal(pickWheelIndex(() => 0.9999999999, 8), 7);
  assert.equal(pickWheelIndex(seededRng('x'), 12), pickWheelIndex(seededRng('x'), 12));
  assert.throws(() => pickWheelIndex(rng, 0), RangeError);
});
