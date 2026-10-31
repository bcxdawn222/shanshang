import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fortune } from '../src/index.js';

test('同一生日同一天结果相同', () => {
  const a = fortune({ dateStr: '2026-10-30', month: 3, day: 21 });
  const b = fortune({ dateStr: '2026-10-30', month: 3, day: 21 });
  assert.deepEqual(a, b);
  assert.equal(a.zodiac.key, 'aries');
});

test('不同日期或生日结果会变化', () => {
  const texts = new Set();
  for (let d = 1; d <= 28; d += 1) {
    const f = fortune({ dateStr: `2026-02-${String(d).padStart(2, '0')}`, month: 7, day: 1 });
    texts.add(JSON.stringify([f.stars, f.text, f.luckyColor]));
  }
  assert.ok(texts.size > 20);
});

test('星级 1~5，文案词槽全部填满，幸运色有效', () => {
  for (let m = 1; m <= 12; m += 1) {
    for (const d of [1, 15, 28]) {
      const f = fortune({ dateStr: '2026-10-30', month: m, day: d });
      for (const v of Object.values(f.stars)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 5);
      assert.ok(f.text.length > 0);
      assert.doesNotMatch(f.text, /\{\w+\}/);
      assert.ok(f.luckyColor.label && f.luckyColor.color);
    }
  }
});

test('library 覆盖与模块名区分', () => {
  const library = {
    templates: { high: ['{zodiac}·{x}·{color}'], mid: ['{zodiac}·{x}·{color}'], low: ['{zodiac}·{x}·{color}'] },
    slots: { x: ['好'] },
    luckyColors: [{ label: '热情红', color: '红色' }],
  };
  const f = fortune({ dateStr: '2026-10-30', month: 1, day: 19, library });
  assert.equal(f.text, '摩羯座·好·热情红');
  assert.deepEqual(f.luckyColor, { label: '热情红', color: '红色' });

  const results = new Set();
  for (const module of ['a', 'b', 'c', 'd', 'e', 'f']) {
    results.add(JSON.stringify(fortune({ dateStr: '2026-10-30', month: 1, day: 19, module })));
  }
  assert.ok(results.size > 1);
});

test('参数校验', () => {
  assert.throws(() => fortune({ dateStr: '2026/10/30', month: 1, day: 1 }), RangeError);
  assert.throws(() => fortune({ dateStr: '2026-10-30', month: 2, day: 30 }), RangeError);
  assert.doesNotThrow(() => fortune({ dateStr: '2026-10-30', month: 2, day: 29 }));
});
