/**
 * 十二星座与星座轮盘默认映射（FUN-01、FUN-03）。
 * 起止月日按常用西方星座口径；摩羯座跨年（12/22 ~ 1/19）。
 */
export const ZODIACS = [
  { key: 'capricorn', name: '摩羯座', start: [12, 22], end: [1, 19] },
  { key: 'aquarius', name: '水瓶座', start: [1, 20], end: [2, 18] },
  { key: 'pisces', name: '双鱼座', start: [2, 19], end: [3, 20] },
  { key: 'aries', name: '白羊座', start: [3, 21], end: [4, 19] },
  { key: 'taurus', name: '金牛座', start: [4, 20], end: [5, 20] },
  { key: 'gemini', name: '双子座', start: [5, 21], end: [6, 21] },
  { key: 'cancer', name: '巨蟹座', start: [6, 22], end: [7, 22] },
  { key: 'leo', name: '狮子座', start: [7, 23], end: [8, 22] },
  { key: 'virgo', name: '处女座', start: [8, 23], end: [9, 22] },
  { key: 'libra', name: '天秤座', start: [9, 23], end: [10, 23] },
  { key: 'scorpio', name: '天蝎座', start: [10, 24], end: [11, 22] },
  { key: 'sagittarius', name: '射手座', start: [11, 23], end: [12, 21] },
];

export const ZODIAC_BY_KEY = Object.fromEntries(ZODIACS.map((z) => [z.key, z]));

// 闰年口径：2 月按 29 天算，生日不含年份
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 校验月日，非法时抛 RangeError */
export function assertMonthDay(month, day) {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`月份不合法：${month}`);
  if (!Number.isInteger(day) || day < 1 || day > DAYS_IN_MONTH[month - 1]) {
    throw new RangeError(`日期不合法：${month}月${day}日`);
  }
}

/** 由月日推出星座，返回 ZODIACS 中的对象 */
export function zodiacOf(month, day) {
  assertMonthDay(month, day);
  const md = month * 100 + day;
  for (const z of ZODIACS) {
    const s = z.start[0] * 100 + z.start[1];
    const e = z.end[0] * 100 + z.end[1];
    // 跨年区间（摩羯）：s > e
    if (s <= e ? md >= s && md <= e : md >= s || md <= e) return z;
  }
  throw new RangeError(`无法匹配星座：${month}月${day}日`);
}

const c = (label, color) => ({ label, color });
const s = (label, scene) => ({ label, scene });

/** 默认轮盘：每星座 8 格，颜色名、场景名与字典一致；管理员可覆盖 */
export const DEFAULT_ZODIAC_WHEEL = {
  aries: [
    c('热情红', '红色'), c('活力橙', '橙色'), c('明亮黄', '黄色'), c('经典黑', '黑色'),
    c('纯净白', '白色'), s('运动风', '运动'), s('派对风', '生日派对'), s('旅拍风', '旅行拍照'),
  ],
  taurus: [
    c('森林绿', '绿色'), c('温柔粉', '粉色'), c('奶油米', '米色'), c('大地棕', '棕色'),
    c('雾霾灰', '灰色'), s('约会风', '约会'), s('休闲风', '休闲'), s('见家长', '见家长'),
  ],
  gemini: [
    c('柠檬黄', '黄色'), c('天空蓝', '蓝色'), c('薄荷绿', '绿色'), c('纯净白', '白色'),
    c('珊瑚橙', '橙色'), s('闺蜜风', '闺蜜'), s('旅拍风', '旅行拍照'), s('派对风', '生日派对'),
  ],
  cancer: [
    c('月光白', '白色'), c('珍珠灰', '灰色'), c('温柔粉', '粉色'), c('海水蓝', '蓝色'),
    c('奶油米', '米色'), s('见家长', '见家长'), s('休闲风', '休闲'), s('约会风', '约会'),
  ],
  leo: [
    c('耀金黄', '黄色'), c('热情红', '红色'), c('落日橙', '橙色'), c('经典黑', '黑色'),
    c('高贵紫', '紫色'), s('宴会风', '宴会'), s('派对风', '生日派对'), s('旅拍风', '旅行拍照'),
  ],
  virgo: [
    c('简约白', '白色'), c('高级灰', '灰色'), c('燕麦米', '米色'), c('橄榄绿', '绿色'),
    c('雅致棕', '棕色'), s('通勤风', '通勤'), s('面试风', '面试'), s('见家长', '见家长'),
  ],
  libra: [
    c('樱花粉', '粉色'), c('浅雾蓝', '蓝色'), c('薰衣草紫', '紫色'), c('奶油米', '米色'),
    c('纯净白', '白色'), s('约会风', '约会'), s('宴会风', '宴会'), s('闺蜜风', '闺蜜'),
  ],
  scorpio: [
    c('神秘黑', '黑色'), c('酒红', '红色'), c('暗夜紫', '紫色'), c('深海蓝', '蓝色'),
    c('炭灰', '灰色'), s('宴会风', '宴会'), s('约会风', '约会'), s('通勤风', '通勤'),
  ],
  sagittarius: [
    c('活力橙', '橙色'), c('天空蓝', '蓝色'), c('草木绿', '绿色'), c('阳光黄', '黄色'),
    c('摩卡棕', '棕色'), s('旅拍风', '旅行拍照'), s('运动风', '运动'), s('休闲风', '休闲'),
  ],
  capricorn: [
    c('沉稳黑', '黑色'), c('高级灰', '灰色'), c('咖啡棕', '棕色'), c('墨绿', '绿色'),
    c('雅白', '白色'), s('通勤风', '通勤'), s('面试风', '面试'), s('见家长', '见家长'),
  ],
  aquarius: [
    c('电光蓝', '蓝色'), c('银灰', '灰色'), c('梦幻紫', '紫色'), c('纯白', '白色'),
    c('柠檬黄', '黄色'), s('休闲风', '休闲'), s('闺蜜风', '闺蜜'), s('运动风', '运动'),
  ],
  pisces: [
    c('海洋蓝', '蓝色'), c('梦幻紫', '紫色'), c('浅粉', '粉色'), c('月光白', '白色'),
    c('薄荷绿', '绿色'), s('约会风', '约会'), s('旅拍风', '旅行拍照'), s('派对风', '生日派对'),
  ],
};

/** 轮盘结果在启动前由种子确定：返回 [0, n) 的格子下标 */
export function pickWheelIndex(rng, n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`格数不合法：${n}`);
  return Math.min(n - 1, Math.floor(rng() * n));
}
