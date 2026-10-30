import { mergeWeights, recommend, seededRng } from '@shanshang/shared';
import { button, h, toast } from '../dom.js';
import { trackEvent } from '../events.js';
import { loadFunConfig, todayStr } from '../fun.js';
import { loadGarments } from '../garments.js';
import { getDeviceSessionId } from '../session.js';
import { garmentGrid } from './browse.js';
import { GENDER_OPTIONS, genderLabel, pickGrid, runAsync } from './funKit.js';
import { pageShell } from './layout.js';

/**
 * AI智趣推荐（FUN-06~08）：性别 → 场合 → 感觉 → recommend()（规则算法）。
 * 设备会话内记录“问题 → 已推荐服饰”，同一问题再问时排除；候选耗尽提示并重置该问题。
 * 设备会话变化（离开待机）时整份记录清空。每次展示调用 trackEvent('ai_recommend')。
 */
const COUNT = 6;
const EXHAUSTED_TEXT = '已经为你推荐完全部搭配';

let memory = { sessionId: null, asked: new Map() };

function questionMemory(questionKey) {
  const sid = getDeviceSessionId();
  if (memory.sessionId !== sid) memory = { sessionId: sid, asked: new Map() };
  if (!memory.asked.has(questionKey)) memory.asked.set(questionKey, { seen: new Set(), round: 0 });
  return memory.asked.get(questionKey);
}

/** 纯逻辑：给定问题算下一批，并更新会话记录。返回 { items, reset } */
function nextBatch(garments, { gender, occasion, feeling, questionKey }) {
  const mem = questionMemory(questionKey);
  const weights = mergeWeights(occasion, feeling);
  const run = () => {
    mem.round += 1;
    const rng = seededRng(todayStr(), getDeviceSessionId(), questionKey, mem.round);
    return recommend(garments, { gender, weights, rng, count: COUNT, exclude: mem.seen });
  };
  let result = run();
  let reset = false;
  if (result.exhausted) {
    reset = true;
    mem.seen.clear();
    result = run();
  }
  for (const g of result.items) mem.seen.add(g.id);
  return { items: result.items, reset };
}

export function openRecommend(nav) {
  nav.push({
    render(root, nav2) {
      const body = pageShell(root, nav2, { title: 'AI智趣推荐', subtitle: '第 1 步 · 为谁挑选？' });
      body.append(pickGrid(GENDER_OPTIONS.map((g) => ({ ...g, onTap: () => pickOccasion(nav2, g.key) })), 3));
    },
  });
}

function pickOccasion(nav, gender) {
  nav.push({
    render(root, nav2) {
      const body = pageShell(root, nav2, { title: 'AI智趣推荐', subtitle: `${genderLabel(gender)} · 第 2 步 · 要去什么场合？` });
      return runAsync(body, loadFunConfig, (cfg) => {
        body.replaceChildren(
          pickGrid(
            cfg.recommendOptions.occasions.map((o) => ({ label: o.label, onTap: () => pickFeeling(nav2, gender, o) })),
            2,
          ),
        );
      });
    },
  });
}

function pickFeeling(nav, gender, occasion) {
  nav.push({
    render(root, nav2) {
      const body = pageShell(root, nav2, { title: 'AI智趣推荐', subtitle: `${genderLabel(gender)} · ${occasion.label} · 第 3 步 · 想要什么感觉？` });
      return runAsync(body, loadFunConfig, (cfg) => {
        body.replaceChildren(
          pickGrid(
            cfg.recommendOptions.feelings.map((f) => ({ label: f.label, onTap: () => nav2.push(resultEntry(gender, occasion, f)) })),
            2,
          ),
        );
      });
    },
  });
}

function resultEntry(gender, occasion, feeling) {
  const questionKey = `${gender}:${occasion.key}:${feeling.key}`;
  // 结果挂在 entry 上：从试穿页返回不会换一批，也不重复上报
  const state = { result: null, sessionId: null };

  return {
    render(root, nav) {
      const body = pageShell(root, nav, {
        title: 'AI智趣推荐',
        subtitle: `${genderLabel(gender)} · ${occasion.label} · ${feeling.label}`,
      });

      const show = ({ items, reset }) => {
        if (reset && items.length) toast(`${EXHAUSTED_TEXT}，重新为你挑选`);
        body.replaceChildren(
          items.length
            ? h('p', { class: 'fun-section-title' }, reset ? `${EXHAUSTED_TEXT} · 已重新挑选` : `为你推荐 ${items.length} 件 · 点击试穿`)
            : h('p', { class: 'page-msg' }, `暂无可推荐的${genderLabel(gender)}服饰`),
          items.length ? garmentGrid(items, nav) : null,
          items.length ? button('换一批', () => void refresh(), 'btn btn-primary fun-more') : null,
        );
      };

      let stop = null;
      const refresh = () => {
        stop?.();
        stop = runAsync(
          body,
          async () => nextBatch(await loadGarments(), { gender, occasion, feeling, questionKey }),
          (result) => {
            state.result = result;
            state.sessionId = getDeviceSessionId();
            if (result.items.length) {
              trackEvent('ai_recommend', { garmentIds: result.items.map((g) => g.id), questionKey });
            }
            show(result);
          },
        );
      };

      if (state.result && state.sessionId === getDeviceSessionId()) show({ ...state.result, reset: false });
      else refresh();
      return () => stop?.();
    },
  };
}
