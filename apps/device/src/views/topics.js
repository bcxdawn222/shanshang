import { errorMessage, mediaUrl, request } from '../api.js';
import { button, h } from '../dom.js';
import { loadGarments } from '../garments.js';
import { garmentGrid } from './browse.js';
import { failure, loading, pageShell } from './layout.js';

/**
 * 热门榜（GET /api/device/hot）与热播短剧同款（GET /api/device/dramas）。
 * 接口未上线（404）时按空列表处理，显示“暂无内容”。
 */
async function fetchItems(path) {
  const { status, data } = await request(path);
  if (status === 404) return [];
  if (status !== 200) throw new Error(errorMessage(data, `加载失败（${status}）`));
  return Array.isArray(data?.items) ? data.items : [];
}

function remotePage({ title, subtitle, load, renderList, emptyText = '暂无内容' }) {
  return {
    render(root, nav) {
      const body = pageShell(root, nav, { title, subtitle });
      let alive = true;
      const run = async () => {
        loading(body);
        try {
          const items = await load();
          if (!alive) return;
          if (!items.length) body.replaceChildren(h('p', { class: 'page-msg' }, emptyText));
          else body.replaceChildren(renderList(items, nav));
        } catch (error) {
          if (!alive) return;
          failure(body, error instanceof TypeError ? '网络异常，请稍后再试' : error.message, run);
        }
      };
      void run();
      return () => {
        alive = false;
      };
    },
  };
}

/** 热门榜：近 7 天试穿次数排序（含置顶），点击进入试穿，试穿页服饰条用这份榜单 */
export function browseHot(nav) {
  nav.push(
    remotePage({
      title: '热门榜',
      subtitle: '近 7 天试穿最多 · 点击服饰开始试穿',
      load: () => fetchItems('device/hot'),
      renderList: (items, nav2) => garmentGrid(items, nav2, { ranked: true }),
    }),
  );
}

/** 热播短剧同款：专题列表 → 专题内同款服饰 */
export function browseDramas(nav) {
  nav.push(
    remotePage({
      title: '热播短剧同款',
      subtitle: '选择一部短剧',
      load: () => fetchItems('device/dramas'),
      renderList: (items, nav2) =>
        h(
          'div',
          { class: 'drama-grid' },
          items.map((d) =>
            button(
              [
                d.posterUrl
                  ? h('img', { class: 'drama-poster', src: mediaUrl(d.posterUrl), alt: '', loading: 'lazy', draggable: 'false' })
                  : h('div', { class: 'drama-poster is-empty', 'aria-hidden': 'true' }, '🎬'),
                h('span', { class: 'drama-title' }, d.title || ''),
              ],
              () => browseDrama(nav2, d),
              'btn drama-card',
            ),
          ),
        ),
    }),
  );
}

function browseDrama(nav, drama) {
  const ids = Array.isArray(drama.garmentIds) ? drama.garmentIds : [];
  nav.push(
    remotePage({
      title: drama.title || '短剧同款',
      subtitle: '同款服饰 · 点击开始试穿',
      emptyText: '该专题暂无可试穿的服饰',
      load: async () => {
        // 专题里的服饰以设备可见清单为准，找不到（下架 / 隐藏）的跳过，保持专题顺序
        const byId = new Map((await loadGarments()).map((g) => [String(g.id), g]));
        return ids.map((id) => byId.get(String(id))).filter(Boolean);
      },
      renderList: garmentGrid,
    }),
  );
}
