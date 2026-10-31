import { writeAudit } from '../lib/audit.js';
import {
  FORTUNE_LIST_MAX,
  FORTUNE_SLOTS,
  FORTUNE_TIERS,
  FUN_KEYS,
  LABEL_MAX,
  LUCKY_COLOR_MAX,
  OPTION_MAX,
  SLOT_WORD_MAX,
  TEMPLATE_MAX,
  WEIGHT_KINDS,
  WEIGHT_MAX,
  WHEEL_MAX_CELLS,
  WHEEL_MIN_CELLS,
  ZODIAC_KEYS,
  getFun,
  normalizeFortune,
  normalizeOptions,
  normalizeWheel,
  resetFun,
  setFun,
} from '../lib/fun.js';
import { requireAccount } from '../lib/guards.js';

const tagName = { type: 'string', minLength: 1, maxLength: 20 };
const label = { type: 'string', minLength: 1, maxLength: LABEL_MAX };

const cellSchema = {
  type: 'object',
  required: ['label'],
  additionalProperties: false,
  properties: { label, color: tagName, scene: tagName },
};

// 整体替换：12 个星座都要给，每个 8~12 格
const wheelBody = {
  type: 'object',
  required: ZODIAC_KEYS,
  additionalProperties: false,
  properties: Object.fromEntries(
    ZODIAC_KEYS.map((k) => [k, { type: 'array', minItems: WHEEL_MIN_CELLS, maxItems: WHEEL_MAX_CELLS, items: cellSchema }]),
  ),
};

const weightsSchema = {
  type: 'object',
  maxProperties: 30,
  propertyNames: { minLength: 1, maxLength: 20 },
  additionalProperties: { type: 'number', minimum: 0, maximum: WEIGHT_MAX },
};

const optionSchema = {
  type: 'object',
  required: ['key', 'label'],
  additionalProperties: false,
  properties: {
    // 设备会话内按 key 记录“问题 → 已推荐服饰”（FUN-07）
    key: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,31}$' },
    label,
    ...Object.fromEntries(Object.keys(WEIGHT_KINDS).map((k) => [k, weightsSchema])),
  },
};

const optionsBody = {
  type: 'object',
  required: ['occasions', 'feelings'],
  additionalProperties: false,
  properties: {
    occasions: { type: 'array', minItems: 1, maxItems: OPTION_MAX, items: optionSchema },
    feelings: { type: 'array', minItems: 1, maxItems: OPTION_MAX, items: optionSchema },
  },
};

const strList = (maxLength) => ({
  type: 'array',
  minItems: 1,
  maxItems: FORTUNE_LIST_MAX,
  items: { type: 'string', minLength: 1, maxLength },
});

// 运势文案库：三档模板、五类词槽、幸运色都要给，整体替换
const fortuneBody = {
  type: 'object',
  required: ['templates', 'slots', 'luckyColors'],
  additionalProperties: false,
  properties: {
    templates: {
      type: 'object',
      required: FORTUNE_TIERS,
      additionalProperties: false,
      properties: Object.fromEntries(FORTUNE_TIERS.map((k) => [k, strList(TEMPLATE_MAX)])),
    },
    slots: {
      type: 'object',
      required: FORTUNE_SLOTS,
      additionalProperties: false,
      properties: Object.fromEntries(FORTUNE_SLOTS.map((k) => [k, strList(SLOT_WORD_MAX)])),
    },
    luckyColors: {
      type: 'array',
      minItems: 1,
      maxItems: LUCKY_COLOR_MAX,
      items: {
        type: 'object',
        required: ['label', 'color'],
        additionalProperties: false,
        properties: { label, color: tagName },
      },
    },
  },
};

const SECTIONS = [
  {
    path: 'zodiac-wheel',
    field: 'zodiacWheel',
    action: 'fun.zodiac',
    body: wheelBody,
    normalize: normalizeWheel,
    summary: (v) => ({ cells: Object.values(v).reduce((n, cells) => n + cells.length, 0) }),
  },
  {
    path: 'recommend-options',
    field: 'recommendOptions',
    action: 'fun.recommend',
    body: optionsBody,
    normalize: normalizeOptions,
    summary: (v) => ({ occasions: v.occasions.length, feelings: v.feelings.length }),
  },
  {
    path: 'fortune-library',
    field: 'fortuneLibrary',
    action: 'fun.fortune',
    body: fortuneBody,
    normalize: normalizeFortune,
    summary: (v) => ({
      templates: Object.values(v.templates).reduce((n, l) => n + l.length, 0),
      words: Object.values(v.slots).reduce((n, l) => n + l.length, 0),
      luckyColors: v.luckyColors.length,
    }),
  },
];

// 总后台 Phase 6：玩法配置（FUN-03、FUN-06、ADM-07）。返回 { configured, value, updatedAt }，未配置时 value 为 null
export default async function adminFunRoutes(app, { ctx }) {
  const { db, now } = ctx;
  app.addHook('preValidation', requireAccount('admin'));

  const audit = (request, action, targetId, detail) =>
    writeAudit(db, { actorId: request.account.id, action, targetType: 'fun_config', targetId, detail, ip: request.ip, now: now() });

  for (const s of SECTIONS) {
    app.get(`/admin/fun/${s.path}`, async () => getFun(db, s.field));

    app.put(`/admin/fun/${s.path}`, { schema: { body: s.body } }, async (request) => {
      const value = s.normalize(db, request.body);
      db.transaction(() => {
        setFun(db, s.field, value, request.account.id, now());
        audit(request, s.action, FUN_KEYS[s.field], s.summary(value));
      })();
      return getFun(db, s.field);
    });

    // 恢复默认：删掉自定义配置，设备回落到共享默认值
    app.post(`/admin/fun/${s.path}/reset`, async (request) => {
      db.transaction(() => {
        resetFun(db, s.field);
        audit(request, s.action, FUN_KEYS[s.field], { reset: true });
      })();
      return getFun(db, s.field);
    });
  }
}
