import { button, h, toast } from '../dom.js';
import { browseGender, browseBanquet } from './browse.js';
import { playerEntry } from './player.js';
import { browseDramas, browseHot } from './topics.js';
import { openFortune } from './fortune.js';
import { openRecommend } from './recommend.js';
import { openZodiac } from './zodiac.js';

/** 首页 10 个一级入口；没有 open 的入口提示“即将开放” */
const ENTRIES = [
  { key: 'male', label: '流行男装', icon: '👔', open: (nav) => browseGender(nav, 'male') },
  { key: 'female', label: '流行女装', icon: '👗', open: (nav) => browseGender(nav, 'female') },
  { key: 'kid', label: '童装', icon: '🧸', open: (nav) => browseGender(nav, 'kid') },
  { key: 'hot', label: '热门榜', icon: '🔥', open: (nav) => browseHot(nav) },
  { key: 'banquet', label: '宴会时装', icon: '🥂', open: (nav) => browseBanquet(nav) },
  { key: 'drama', label: '热播短剧同款', icon: '🎬', open: (nav) => browseDramas(nav) },
  { key: 'fortune', label: '运势穿搭', icon: '🔮', open: (nav) => openFortune(nav) },
  { key: 'zodiac', label: '星座轮盘', icon: '♈', open: (nav) => openZodiac(nav) },
  { key: 'ai', label: 'AI智趣推荐', icon: '✨', open: (nav) => openRecommend(nav) },
  { key: 'ads', label: '广告短剧热门', icon: '📺', open: (nav) => nav.push(playerEntry) },
];

export const homeEntry = {
  render(root, nav) {
    const grid = h(
      'div',
      { class: 'home-grid' },
      ENTRIES.map((entry) =>
        button(
          [
            h('span', { class: 'home-icon', 'aria-hidden': 'true' }, entry.icon),
            h('span', { class: 'home-label' }, entry.label),
            entry.open ? null : h('span', { class: 'home-soon' }, '即将开放'),
          ],
          () => (entry.open ? entry.open(nav) : toast(`「${entry.label}」即将开放，敬请期待`)),
          `btn home-tile${entry.open ? '' : ' is-soon'}`,
        ),
      ),
    );
    root.append(h('div', { class: 'home' }, h('p', { class: 'home-tip' }, '选择一个分类，开始实时试穿'), grid));
  },
};
