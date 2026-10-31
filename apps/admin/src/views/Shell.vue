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
    <!-- 顶栏换成 GlassNavbar 后 el-container 识别不到 ElHeader，需显式 vertical -->
    <el-container direction="vertical">
      <GlassNavbar class="header">
        <template #brand>
          <span class="title">{{ route.meta.title }}</span>
        </template>
        <template #right>
          <div class="user">
            <!-- SET-04：商家后台黑 / 白主题，只影响后台自身 -->
            <el-switch
              v-if="!isAdmin"
              :model-value="merchantTheme === 'dark'"
              inline-prompt
              :active-icon="Moon"
              :inactive-icon="Sunny"
              aria-label="切换黑 / 白主题"
              @change="(v) => setMerchantTheme(v ? 'dark' : 'light')"
            />
            <span>{{ store.account?.nickname || store.account?.username }}</span>
            <el-button link type="primary" @click="onLogout">退出</el-button>
          </div>
        </template>
      </GlassNavbar>
      <el-main>
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import {
  Camera,
  ChatDotRound,
  Coin,
  CollectionTag,
  DataLine,
  Document,
  Film,
  Key,
  MagicStick,
  Monitor,
  Moon,
  OfficeBuilding,
  Phone,
  Picture,
  Present,
  Setting,
  Shop,
  Stamp,
  Sunny,
  Tickets,
  TrendCharts,
  User,
  VideoPlay,
  Wallet,
} from '@element-plus/icons-vue';
import { computed, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Brand from '../components/Brand.vue';
import { GlassNavbar } from '../components/glass/index.js';
import { logout, store } from '../store.js';
import { applyTheme, merchantTheme, setMerchantTheme } from '../theme.js';

const route = useRoute();
const router = useRouter();
const isAdmin = computed(() => store.account?.role === 'admin');
// 总后台始终白色；商家后台按本地保存的主题
watchEffect(() => applyTheme(store.account?.role));

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
        { path: '/admin/fun', title: '玩法配置', icon: MagicStick },
        { path: '/admin/points', title: '积分管理', icon: Coin },
        { path: '/admin/snapshots', title: '快照核销', icon: Camera },
        { path: '/admin/stats', title: '数据统计', icon: DataLine },
        { path: '/admin/feedback', title: '留言反馈', icon: ChatDotRound },
        { path: '/admin/settings', title: '平台设置', icon: Setting },
        { path: '/admin/site-extras', title: '站点信息', icon: OfficeBuilding },
        { path: '/admin/audit-logs', title: '操作日志', icon: Document },
        { path: '/admin/password', title: '修改口令', icon: Key },
      ]
    : [
        { path: '/merchant/home', title: '账号概览', icon: User },
        { path: '/merchant/garments', title: '我的服饰', icon: Picture },
        { path: '/merchant/points', title: '积分与充值', icon: Wallet },
        { path: '/merchant/redeem', title: '核销', icon: Stamp },
        { path: '/merchant/stats', title: '数据统计', icon: DataLine },
        { path: '/merchant/contact', title: '联系我们', icon: Phone },
        { path: '/merchant/feedback', title: '留言反馈', icon: ChatDotRound },
        { path: '/merchant/tip', title: '打赏作者', icon: Present },
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
/* 侧栏 / 顶栏是 el-main 的兄弟节点，可以加 backdrop-filter；
   不要加在 .shell / el-main 上，否则 el-dialog 的 fixed 遮罩会被限制在里面 */
.aside {
  background: var(--glass-bg);
  border-right: 1px solid var(--glass-edge);
  box-shadow: 1px 0 0 var(--glass-border) inset;
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  overflow-y: auto;
}
.aside-brand {
  padding: 20px 18px 4px;
}
.role {
  padding: 0 16px 10px 60px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.menu {
  border-right: none;
}
/* 玻璃面 / 吸顶 / 高度由 GlassNavbar 负责；它是 el-main 的兄弟节点，可以带 backdrop-filter */
.header {
  flex-shrink: 0;
  justify-content: space-between;
}
.title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.user {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: var(--el-text-color-regular);
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
