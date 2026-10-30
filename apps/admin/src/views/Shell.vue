<template>
  <el-container class="shell">
    <el-aside width="200px" class="aside">
      <Brand class="aside-brand" />
      <div class="role">{{ isAdmin ? '总后台' : '商家后台' }}</div>
      <el-menu :default-active="route.path" router class="menu">
        <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
          <el-icon><component :is="m.icon" /></el-icon>
          <span>{{ m.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span class="title">{{ route.meta.title }}</span>
        <div class="user">
          <span>{{ store.account?.nickname || store.account?.username }}</span>
          <el-button link type="primary" @click="onLogout">退出</el-button>
        </div>
      </el-header>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import {
  Camera,
  Coin,
  CollectionTag,
  Document,
  Film,
  Key,
  Monitor,
  Picture,
  Setting,
  Shop,
  Stamp,
  Tickets,
  TrendCharts,
  User,
  VideoPlay,
  Wallet,
} from '@element-plus/icons-vue';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Brand from '../components/Brand.vue';
import { logout, store } from '../store.js';

const route = useRoute();
const router = useRouter();
const isAdmin = computed(() => store.account?.role === 'admin');

// 菜单只是入口，权限以服务端为准
const menus = computed(() =>
  isAdmin.value
    ? [
        { path: '/admin/merchants', title: '商家管理', icon: Shop },
        { path: '/admin/garments', title: '服饰审核', icon: Picture },
        { path: '/admin/dicts', title: '标签字典', icon: CollectionTag },
        { path: '/admin/devices', title: '设备管理', icon: Monitor },
        { path: '/admin/ads', title: '广告素材', icon: Film },
        { path: '/admin/playlists', title: '播放列表', icon: VideoPlay },
        { path: '/admin/hot', title: '热门榜', icon: TrendCharts },
        { path: '/admin/dramas', title: '短剧专题', icon: Tickets },
        { path: '/admin/points', title: '积分管理', icon: Coin },
        { path: '/admin/snapshots', title: '快照核销', icon: Camera },
        { path: '/admin/settings', title: '平台设置', icon: Setting },
        { path: '/admin/audit-logs', title: '操作日志', icon: Document },
        { path: '/admin/password', title: '修改口令', icon: Key },
      ]
    : [
        { path: '/merchant/home', title: '账号概览', icon: User },
        { path: '/merchant/garments', title: '我的服饰', icon: Picture },
        { path: '/merchant/points', title: '积分与充值', icon: Wallet },
        { path: '/merchant/redeem', title: '核销', icon: Stamp },
        { path: '/merchant/password', title: '修改密码', icon: Key },
      ],
);

async function onLogout() {
  const role = store.account?.role ?? 'merchant';
  await logout();
  router.replace(`/${role}/login`);
}
</script>

<style scoped>
.shell {
  height: 100%;
}
.aside {
  background: #fff;
  border-right: 1px solid #ebeef5;
}
.aside-brand {
  padding: 18px 16px 4px;
}
.role {
  padding: 0 16px 12px 58px;
  font-size: 12px;
  color: #8a8f99;
}
.menu {
  border-right: none;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}
.title {
  font-weight: 600;
}
.user {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
/* 手机扫码核销时窄屏打开：收起侧栏，只留顶栏和内容 */
@media (max-width: 768px) {
  .aside {
    display: none;
  }
  :deep(.el-main) {
    padding: 12px;
  }
}
</style>
