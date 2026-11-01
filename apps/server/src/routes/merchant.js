import { getAccountView } from '../lib/accounts.js';
import { requireAccount } from '../lib/guards.js';
import { getPointsConfig, merchantPoints, queryLedger } from '../lib/points.js';

const profileBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    nickname: { type: 'string', minLength: 1, maxLength: 30 },
    shopLocation: { type: 'string', maxLength: 60 },
  },
};

// 商家接口：一律以登录态里的账号 id 为准，不接受前端传 merchant_id
export default async function merchantRoutes(app, { ctx }) {
  const { db, now } = ctx;
  app.addHook('preValidation', requireAccount('merchant'));

  // 待审核 / 已驳回也能看，用来显示“审核中”或驳回原因
  app.get('/merchant/profile', async (request) => ({ account: getAccountView(db, request.account.id) }));

  // 品牌名不在这里改，商家只能改昵称和店铺位置（SET-01、SET-09）
  app.put(
    '/merchant/profile',
    { schema: { body: profileBody }, preValidation: requireAccount('merchant', { approved: true }) },
    async (request) => {
      const id = request.account.id;
      const { nickname, shopLocation } = request.body;
      const t = now();
      db.transaction(() => {
        if (nickname !== undefined) {
          db.prepare('UPDATE account SET nickname = ?, updated_at = ? WHERE id = ?').run(nickname.trim(), t, id);
        }
        if (shopLocation !== undefined) {
          db.prepare('UPDATE merchant SET shop_location = ? WHERE account_id = ?').run(shopLocation.trim(), id);
        }
      })();
      return { account: getAccountView(db, id) };
    },
  );

  // ---------- 积分（PT-01~06）：只看自己的，不返回 xmaxRatio、Xmax 积分 ----------
  const approved = { preValidation: requireAccount('merchant', { approved: true }) };

  app.get('/merchant/points', approved, async (request) => merchantPoints(db, request.account.id));

  app.get(
    '/merchant/points/ledger',
    {
      ...approved,
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query;
      return queryLedger(db, { merchantId: request.account.id, page, pageSize });
    },
  );

  // 充值方式：联系方式 + 收款码，线下付款后由管理员手动加积分
  app.get('/merchant/recharge', approved, async () => {
    const { rechargeContact, rechargeQrUrl } = getPointsConfig(db);
    return { contact: rechargeContact, qrUrl: rechargeQrUrl };
  });
}
