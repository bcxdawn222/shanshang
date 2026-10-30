import { mediaUrl } from '../api.js';
import { button, h } from '../dom.js';
import { groupBy, isBanquet, loadGarments } from '../garments.js';
import { failure, loading, optionList, pageShell } from './layout.js';
import { tryonEntry } from './tryon.js';

const GENDER_LABEL = { male: '流行男装', female: '流行女装', kid: '童装' };
const SET_TYPES = [
  { key: 'suit', label: '当季热卖套装' },
  { key: 'single', label: '上装单品' },
];

/**
 * 通用“拉清单 → 筛选 → 渲染”页。filter 是纯函数，每次进入页面都按最新清单重算，
 * 这样返回上一层时数据也是新的（清单本身有 60 秒缓存）。
 */
function listPage({ title, subtitle, filter, renderList, emptyText = '暂无可试穿的服饰' }) {
  return {
    render(root, nav) {
      const body = pageShell(root, nav, { title, subtitle });
      let alive = true;
      const load = async () => {
        loading(body);
        try {
          const items = filter(await loadGarments());
          if (!alive) return;
          if (!items.length) body.replaceChildren(h('p', { class: 'page-msg' }, emptyText));
          else body.replaceChildren(renderList(items, nav));
        } catch (error) {
          if (!alive) return;
          failure(body, error instanceof TypeError ? '网络异常，请稍后再试' : error.message, load);
        }
      };
      void load();
      return () => {
        alive = false;
      };
    },
  };
}

/** 男/女/童 → 套装/单品 */
export function browseGender(nav, gender) {
  const title = GENDER_LABEL[gender];
  nav.push(
    listPage({
      title,
      subtitle: '请选择类型',
      filter: (all) => all.filter((g) => g.gender === gender),
      renderList: (items, nav2) => {
        const counts = groupBy(items, (g) => g.setType);
        return optionList(
          SET_TYPES.map((t) => ({
            label: t.label,
            sub: `${counts.get(t.key)?.length || 0} 件`,
            onTap: () => browseBrand(nav2, { gender, setType: t.key, path: [title, t.label] }),
          })),
        );
      },
    }),
  );
}

/** 宴会时装：场景含“宴会”，直接进入服饰网格 */
export function browseBanquet(nav) {
  nav.push(
    listPage({
      title: '宴会时装',
      subtitle: '点击服饰开始试穿',
      filter: (all) => all.filter(isBanquet),
      renderList: garmentGrid,
    }),
  );
}

function browseBrand(nav, { gender, setType, path }) {
  const base = (all) => all.filter((g) => g.gender === gender && g.setType === setType);
  nav.push(
    listPage({
      title: '选择品牌',
      subtitle: path.join(' · '),
      filter: base,
      renderList: (items, nav2) =>
        optionList(
          [...groupBy(items, (g) => g.brandName || '其他品牌')].map(([brand, list]) => ({
            label: brand,
            sub: `${list.length} 件`,
            onTap: () =>
              browseCategory(nav2, {
                filter: (all) => base(all).filter((g) => (g.brandName || '其他品牌') === brand),
                path: [...path, brand],
              }),
          })),
        ),
    }),
  );
}

function browseCategory(nav, { filter, path }) {
  nav.push(
    listPage({
      title: '选择品类',
      subtitle: path.join(' · '),
      filter,
      renderList: (items, nav2) =>
        optionList(
          [...groupBy(items, (g) => g.category || '其他')].map(([category, list]) => ({
            label: category,
            sub: `${list.length} 件`,
            onTap: () =>
              nav2.push(
                listPage({
                  title: category,
                  subtitle: [...path, '点击服饰开始试穿'].join(' · '),
                  filter: (all) => filter(all).filter((g) => (g.category || '其他') === category),
                  renderList: garmentGrid,
                }),
              ),
          })),
        ),
    }),
  );
}

/** 服饰网格：点击进入试穿，试穿页底部服饰条就是这个列表 */
function garmentGrid(items, nav) {
  return h(
    'div',
    { class: 'garment-grid' },
    items.map((g) =>
      button(
        [
          h('img', { class: 'garment-img', src: mediaUrl(g.imagePath), alt: g.title || '', loading: 'lazy', draggable: 'false' }),
          h('span', { class: 'garment-title' }, g.title || ''),
          g.discountText ? h('span', { class: 'garment-discount' }, g.discountText) : null,
        ],
        () => nav.push(tryonEntry(items, g.id)),
        'btn garment-card',
      ),
    ),
  );
}
