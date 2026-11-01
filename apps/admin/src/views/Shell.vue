<template>
  <el-container class="shell">
    <el-aside width="200px" class="aside">
      <Brand class="aside-brand" />
      <div class="role">{{ isAdmin ? '总后台' : '商家后台' }}</div>
      <!-- 相关栏目合并成分组，点开再选二级功能；当前页所在分组默认展开 -->
      <el-menu :default-active="route.path" :default-openeds="openeds" router class="menu">
        <template v-for="m in menus" :key="m.path || m.title">
          <el-sub-menu v-if="m.children" :index="m.title">
            <template #title>
              <el-icon><component :is="m.icon" /></el-icon>
              <span>{{ m.title }}</span>
            </template>
            <el-menu-item v-for="c in m.children" :key="c.path" :index="c.path">{{ c.title }}</el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="m.path">
            <el-icon><component :is="m.icon" /></el-icon>
            <span>{{ m.title }}</span>
          </el-menu-item>
        </template>
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
  ChatDotRound,
  Coin,
  DataLine,
  Key,
  MagicStick,
  Monitor,
  Moon,
  Picture,
  Setting,
  Shop,
  Stamp,
  Sunny,
  User,
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

// 菜单只是入口，权限以服务端为准；有 children 的是分组（二级菜单）
const menus = computed(() =>
  isAdmin.value
    ? [
        {
          title: '商家与服饰',
          icon: Shop,
          children: [
            { path: '/admin/merchants', title: '商家管理' },
            { path: '/admin/garments', title: '服饰审核' },
            { path: '/admin/dicts', title: '标签字典' },
          ],
        },
        {
          title: '设备与投放',
          icon: Monitor,
          children: [
            { path: '/admin/devices', title: '设备管理' },
            { path: '/admin/ads', title: '广告素材' },
            { path: '/admin/playlists', title: '播放列表' },
          ],
        },
        {
          title: '内容运营',
          icon: MagicStick,
          children: [
            { path: '/admin/hot', title: '热门榜' },
            { path: '/admin/dramas', title: '短剧专题' },
            { path: '/admin/fun', title: '玩法配置' },
          ],
        },
        {
          title: '积分与核销',
          icon: Coin,
          children: [
            { path: '/admin/points', title: '积分管理' },
            { path: '/admin/snapshots', title: '快照核销' },
          ],
        },
        { path: '/admin/stats', title: '数据统计', icon: DataLine },
        {
          title: '系统设置',
          icon: Setting,
          children: [
            { path: '/admin/settings', title: '平台设置' },
            { path: '/admin/site-extras', title: '站点信息' },
            { path: '/admin/feedback', title: '留言反馈' },
            { path: '/admin/audit-logs', title: '操作日志' },
            { path: '/admin/password', title: '修改口令' },
          ],
        },
      ]
    : [
        { path: '/merchant/home', title: '账号概览', icon: User },
        { path: '/merchant/garments', title: '我的服饰', icon: Picture },
        { path: '/merchant/points', title: '积分与充值', icon: Wallet },
        { path: '/merchant/redeem', title: '核销', icon: Stamp },
        { path: '/merchant/stats', title: '数据统计', icon: DataLine },
        {
          title: '帮助与反馈',
          icon: ChatDotRound,
          children: [
            { path: '/merchant/contact', title: '联系我们' },
            { path: '/merchant/feedback', title: '留言反馈' },
            { path: '/merchant/tip', title: '打赏作者' },
          ],
        },
        { path: '/merchant/password', title: '修改密码', icon: Key },
      ],
);

// 当前页所在的分组默认展开
const openeds = computed(() =>
  menus.value.filter((m) => m.children?.some((c) => c.path === route.path)).map((m) => m.title),
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
/* 分组标题与一级菜单项同样的胶囊样式；二级项缩进对齐分组文字（glass.css 对一级项强制了 12px 左边距） */
.menu :deep(.el-sub-menu__title) {
  height: 40px;
  line-height: 40px;
  margin: 2px 10px;
  padding-left: 12px !important;
  border-radius: 10px;
}
.menu :deep(.el-sub-menu .el-menu) {
  padding: 0;
}
.menu :deep(.el-sub-menu .el-menu-item) {
  height: 36px;
  line-height: 36px;
  padding-left: 42px !important;
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
