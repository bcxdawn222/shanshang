import { fortune, matchWheel, seededRng } from '@shanshang/shared';
import { h } from '../dom.js';
import { colorHex, loadFunConfig, todayStr } from '../fun.js';
import { loadGarments } from '../garments.js';
import { garmentGrid } from './browse.js';
import { GENDER_OPTIONS, genderLabel, pickGrid, runAsync, starText } from './funKit.js';
import { pageShell } from './layout.js';

/**
 * 运势穿搭（FUN-04、FUN-05）：选月 → 选日 → 选男/女/童 → 今日运势卡 + 3 件推荐。
 * 生日只在页面闭包里，不写 localStorage、不上报。同一生日同一天结果相同（shared/fortune）。
 */
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad2 = (n) => String(n).padStart(2, '0');

export function openFortune(nav) {
  nav.push({
    render(root, nav2) {
      const body = pageShell(root, nav2, { title: '运势穿搭', subtitle: '第 1 步 · 你的生日在几月？' });
      body.append(
        pickGrid(
          DAYS.map((_, i) => ({ label: `${i + 1} 月`, onTap: () => pickDay(nav2, i + 1) })),
          4,
        ),
      );
    },
  });
}

function pickDay(nav, month) {
  nav.push({
    render(root, nav2) {
      const body = pageShell(root, nav2, { title: `${month} 月`, subtitle: '第 2 步 · 选择日期' });
      const days = Array.from({ length: DAYS[month - 1] }, (_, i) => i + 1);
      body.append(pickGrid(days.map((day) => ({ label: String(day), onTap: () => pickGender(nav2, month, day) })), 7));
    },
  });
}

function pickGender(nav, month, day) {
  nav.push({
    render(root, nav2) {
      const body = pageShell(root, nav2, { title: `${month} 月 ${day} 日`, subtitle: '第 3 步 · 为谁挑选？' });
      body.append(pickGrid(GENDER_OPTIONS.map((g) => ({ ...g, onTap: () => nav2.push(resultEntry(month, day, g.key)) })), 3));
    },
  });
}

function starRow(label, n) {
  return h('div', { class: 'fortune-star-row' }, h('span', { class: 'fortune-star-label' }, label), starText(n));
}

function resultEntry(month, day, gender) {
  return {
    render(root, nav) {
      const body = pageShell(root, nav, { title: '今日运势', subtitle: `${month} 月 ${day} 日 · ${genderLabel(gender)}` });
      return runAsync(
        body,
        async () => {
          const dateStr = todayStr();
          const cfg = await loadFunConfig();
          const card = fortune({ dateStr, month, day, library: cfg.fortuneLibrary });
          const garments = await loadGarments();
          const rng = seededRng(dateStr, `${pad2(month)}-${pad2(day)}`, 'fortune-garments', gender);
          const items = matchWheel(garments, card.luckyColor, { gender, rng, count: 3 }).slice(0, 3);
          return { dateStr, card, items };
        },
        ({ dateStr, card, items }) => {
          const swatch = h('span', { class: 'fortune-swatch', 'aria-hidden': 'true' });
          swatch.style.background = colorHex(card.luckyColor.color) || 'var(--accent)';
          body.replaceChildren(
            h(
              'section',
              { class: 'fortune-card' },
              h('p', { class: 'fortune-date' }, dateStr),
              h('p', { class: 'fortune-zodiac' }, card.zodiac.name),
              h(
                'div',
                { class: 'fortune-stars' },
                starRow('综合', card.stars.overall),
                starRow('桃花', card.stars.love),
                starRow('事业', card.stars.career),
              ),
              h('p', { class: 'fortune-text' }, card.text),
              h('p', { class: 'fortune-lucky' }, swatch, h('span', {}, `今日幸运色：${card.luckyColor.label}`)),
            ),
            items.length
              ? h('p', { class: 'fun-section-title' }, '幸运色穿搭 · 点击试穿')
              : h('p', { class: 'page-msg' }, `暂无可推荐的${genderLabel(gender)}服饰`),
            items.length ? garmentGrid(items, nav) : null,
          );
        },
      );
    },
  };
}
