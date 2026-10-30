import { HttpError } from './http.js';

/**
 * 角色守卫。所有权限都在服务端判断，前端隐藏按钮只是体验。
 * approved=true 时，商家必须审核通过才能用（ACC-02：待审核账号只能看到“审核中”）。
 */
export function requireAccount(role, { approved = false } = {}) {
  return async function guard(request) {
    const account = request.account;
    if (!account) throw new HttpError(401, 'UNAUTHENTICATED', '请先登录');
    if (account.role !== role) throw new HttpError(403, 'FORBIDDEN', '没有权限');
    if (account.status === 'disabled') throw new HttpError(403, 'ACCOUNT_DISABLED', '账号已停用，请联系管理员');
    if (approved && account.status !== 'approved') {
      throw new HttpError(403, 'MERCHANT_NOT_APPROVED', '账号审核中，暂不能使用该功能');
    }
  };
}
