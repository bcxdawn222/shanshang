import { createRouter, createWebHashHistory } from 'vue-router';
import { loadMe, store } from './store.js';

// hash 路由：nginx 不用配回退规则
const routes = [
  { path: '/', redirect: '/merchant/login' },
  { path: '/admin/login', component: () => import('./views/Login.vue'), props: { role: 'admin' }, meta: { guest: true } },
  { path: '/merchant/login', component: () => import('./views/Login.vue'), props: { role: 'merchant' }, meta: { guest: true } },
  { path: '/merchant/register', component: () => import('./views/Register.vue'), meta: { guest: true } },
  {
    path: '/admin',
    component: () => import('./views/Shell.vue'),
    meta: { role: 'admin' },
    children: [
      { path: '', redirect: '/admin/merchants' },
      { path: 'merchants', component: () => import('./views/admin/Merchants.vue'), meta: { title: '商家管理' } },
      { path: 'garments', component: () => import('./views/admin/Garments.vue'), meta: { title: '服饰审核' } },
      { path: 'dicts', component: () => import('./views/admin/Dicts.vue'), meta: { title: '标签字典' } },
      { path: 'devices', component: () => import('./views/admin/Devices.vue'), meta: { title: '设备管理' } },
      { path: 'settings', component: () => import('./views/admin/Settings.vue'), meta: { title: '平台设置' } },
      { path: 'audit-logs', component: () => import('./views/admin/AuditLogs.vue'), meta: { title: '操作日志' } },
      { path: 'password', component: () => import('./views/Password.vue'), meta: { title: '修改口令' } },
    ],
  },
  {
    path: '/merchant',
    component: () => import('./views/Shell.vue'),
    meta: { role: 'merchant' },
    children: [
      { path: '', redirect: '/merchant/home' },
      { path: 'home', component: () => import('./views/merchant/Home.vue'), meta: { title: '账号概览' } },
      { path: 'garments', component: () => import('./views/merchant/Garments.vue'), meta: { title: '我的服饰' } },
      { path: 'password', component: () => import('./views/Password.vue'), meta: { title: '修改密码' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHashHistory(), routes });

// 只做页面跳转体验；真正的权限在服务端判断
router.beforeEach(async (to) => {
  if (!store.loaded) await loadMe();
  const role = to.matched.find((r) => r.meta.role)?.meta.role;
  const account = store.account;
  if (role) {
    if (!account || account.role !== role) return `/${role}/login`;
    return true;
  }
  if (to.meta.guest && account) return account.role === 'admin' ? '/admin' : '/merchant';
  return true;
});
