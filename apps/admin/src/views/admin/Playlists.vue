<template>
  <div class="layout">
    <!-- 左：选默认列表或设备 -->
    <el-card shadow="never" class="side" :body-style="{ padding: '0' }">
      <template #header>
        <div class="side-head">
          <span>投放对象</span>
          <el-button link type="primary" :loading="dLoading" @click="loadDevices">刷新</el-button>
        </div>
      </template>
      <el-menu :default-active="current" class="side-menu" @select="select">
        <el-menu-item index="default">
          <span>默认列表</span>
        </el-menu-item>
        <el-menu-item v-for="d in devices" :key="d.id" :index="String(d.id)">
          <div class="dev">
            <span class="dev-name" :title="d.name || d.code">{{ d.name || d.code }}</span>
            <el-tag v-if="d.status === 'disabled'" type="info" size="small">停用</el-tag>
          </div>
        </el-menu-item>
      </el-menu>
      <div v-if="!dLoading && !devices.length" class="muted empty-dev">暂无已绑定设备</div>
    </el-card>

    <!-- 右：编辑条目 -->
    <el-card v-loading="pLoading" shadow="never" class="main">
      <template #header>
        <div class="page-head" style="margin-bottom: 0">
          <div>
            <b>{{ currentTitle }}</b>
            <span class="muted" style="margin-left: 12px">{{ rows.length }} / {{ MAX_ITEMS }} 条，按顺序循环播放</span>
          </div>
          <div>
            <el-button :disabled="rows.length >= MAX_ITEMS" @click="openPicker">添加素材</el-button>
            <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">保存</el-button>
          </div>
        </div>
      </template>

      <el-alert
        v-if="current === 'default'"
        type="info"
        :closable="false"
        show-icon
        class="tip"
        title="未单独配置播放列表的设备都使用默认列表"
      />
      <el-alert
        v-else-if="!configured"
        type="warning"
        :closable="false"
        show-icon
        class="tip"
        title="该设备未单独配置，使用默认列表。添加素材并保存后改为使用本设备的列表"
      />

      <el-table :data="rows" border empty-text="列表为空，点“添加素材”">
        <el-table-column label="#" width="56" align="center">
          <template #default="{ $index }">{{ $index + 1 }}</template>
        </el-table-column>
        <el-table-column label="预览" width="130">
          <template #default="{ row }">
            <template v-if="row.asset">
              <img v-if="row.asset.type === 'image'" :src="mediaUrl(row.asset.url)" :alt="row.asset.name" class="thumb" />
              <video v-else :src="mediaUrl(row.asset.url)" muted preload="metadata" class="thumb" :aria-label="row.asset.name" />
            </template>
          </template>
        </el-table-column>
        <el-table-column label="素材" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <template v-if="row.asset">
              <el-tag :type="row.asset.type === 'video' ? 'primary' : 'success'" size="small" class="type-tag">
                {{ row.asset.type === 'video' ? '视频' : '图片' }}
              </el-tag>
              {{ row.asset.name }}
            </template>
            <span v-else class="danger">素材 #{{ row.assetId }} 已不存在</span>
          </template>
        </el-table-column>
        <el-table-column label="停留时长" width="190">
          <template #default="{ row }">
            <template v-if="row.asset?.type === 'image'">
              <el-input-number v-model="row.seconds" :min="1" :max="120" :step="1" :precision="0" size="small" style="width: 110px" />
              <span class="unit">秒</span>
            </template>
            <span v-else class="muted">播完即切</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ $index }">
            <el-button link :icon="Top" :disabled="$index === 0" aria-label="上移" @click="move($index, -1)">上移</el-button>
            <el-button link :icon="Bottom" :disabled="$index === rows.length - 1" aria-label="下移" @click="move($index, 1)">下移</el-button>
            <el-button link type="danger" @click="rows.splice($index, 1)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 选素材 -->
    <el-dialog v-model="picker.open" title="添加素材" width="720px">
      <div class="page-head">
        <span class="muted">可多选，按勾选顺序追加到列表末尾；同一素材可重复添加</span>
        <el-button link type="primary" @click="loadAssets">刷新素材</el-button>
      </div>
      <el-table
        ref="pickerTable"
        v-loading="aLoading"
        :data="assets"
        border
        max-height="420"
        empty-text="暂无素材，请先到“广告素材”上传"
        @selection-change="(s) => (picker.selected = s)"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column label="预览" width="120">
          <template #default="{ row }">
            <img v-if="row.type === 'image'" :src="mediaUrl(row.url)" :alt="row.name" class="thumb" />
            <video v-else :src="mediaUrl(row.url)" muted preload="metadata" class="thumb" :aria-label="row.name" />
          </template>
        </el-table-column>
        <el-table-column label="类型" width="70" align="center">
          <template #default="{ row }">{{ row.type === 'video' ? '视频' : '图片' }}</template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
      </el-table>
      <template #footer>
        <el-button @click="picker.open = false">取消</el-button>
        <el-button type="primary" :disabled="!picker.selected.length" @click="addPicked">添加 {{ picker.selected.length || '' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { Bottom, Top } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { api, mediaUrl } from '../../api.js';

const MAX_ITEMS = 100;
const DEFAULT_SECONDS = 8;

// ---- 设备 ----
const devices = ref([]);
const dLoading = ref(false);

async function loadDevices() {
  dLoading.value = true;
  try {
    // 只有绑定过的设备才能投放
    devices.value = (await api('admin/devices')).items.filter((d) => d.boundAt);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    dLoading.value = false;
  }
}

// ---- 素材 ----
const assets = ref([]);
const aLoading = ref(false);
const assetMap = computed(() => new Map(assets.value.map((a) => [a.id, a])));

async function loadAssets() {
  aLoading.value = true;
  try {
    assets.value = (await api('admin/ads/assets')).items;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    aLoading.value = false;
  }
}

// ---- 当前列表 ----
const current = ref('default');
const configured = ref(true);
const list = ref([]); // [{ key, assetId, seconds }]
const snapshot = ref('[]');
const pLoading = ref(false);
const saving = ref(false);
let seq = 0;

const rows = computed(() => {
  // 给模板用：附上素材信息；直接返回原对象，改 seconds 能写回
  for (const r of list.value) r.asset = assetMap.value.get(r.assetId) ?? null;
  return list.value;
});

const currentTitle = computed(() => {
  if (current.value === 'default') return '默认列表';
  const d = devices.value.find((x) => String(x.id) === current.value);
  return d ? `设备：${d.name || d.code}` : `设备 #${current.value}`;
});

const payload = () => ({
  // seconds 只对图片生效；视频也带上默认值，避免服务端校验整数时出错
  items: list.value.map((r) => ({ assetId: r.assetId, seconds: Number(r.seconds) || DEFAULT_SECONDS })),
});
const dirty = computed(() => JSON.stringify(payload()) !== snapshot.value);

async function loadPlaylist() {
  pLoading.value = true;
  try {
    const res = await api(`admin/playlists/${current.value}`);
    const items = res.items ?? [];
    list.value = items.map((it) => ({ key: ++seq, assetId: it.assetId, seconds: it.seconds ?? DEFAULT_SECONDS }));
    // 设备是否单独配置：优先看服务端的 configured 字段，没有就按条目是否为空判断
    configured.value = current.value === 'default' || (typeof res.configured === 'boolean' ? res.configured : items.length > 0);
    snapshot.value = JSON.stringify(payload());
  } catch (e) {
    list.value = [];
    snapshot.value = JSON.stringify(payload());
    ElMessage.error(e.message);
  } finally {
    pLoading.value = false;
  }
}

async function confirmDiscard() {
  if (!dirty.value) return true;
  return ElMessageBox.confirm('当前列表有未保存的修改，确定放弃？', '未保存', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
}

async function select(index) {
  if (index === current.value) return;
  if (!(await confirmDiscard())) {
    // el-menu 已切换高亮，强制刷新回原值
    const prev = current.value;
    current.value = '';
    await nextTick();
    current.value = prev;
    return;
  }
  current.value = index;
  await loadPlaylist();
}

onBeforeRouteLeave(confirmDiscard);

function move(i, delta) {
  const [item] = list.value.splice(i, 1);
  list.value.splice(i + delta, 0, item);
}

async function save() {
  const body = payload();
  if (body.items.length > MAX_ITEMS) return ElMessage.warning(`最多 ${MAX_ITEMS} 条`);
  if (list.value.some((r) => !r.asset)) return ElMessage.warning('列表里有已不存在的素材，请先删除');
  if (list.value.some((r) => r.asset.type === 'image' && !(r.seconds >= 1 && r.seconds <= 120))) {
    return ElMessage.warning('图片停留时长需为 1~120 秒');
  }
  saving.value = true;
  try {
    await api(`admin/playlists/${current.value}`, { method: 'PUT', body });
    ElMessage.success('已保存，设备下次拉取时更新');
    await loadPlaylist();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

// ---- 选素材对话框 ----
const pickerTable = ref();
const picker = reactive({ open: false, selected: [] });

function openPicker() {
  picker.selected = [];
  pickerTable.value?.clearSelection();
  picker.open = true;
  loadAssets();
}

function addPicked() {
  const room = MAX_ITEMS - list.value.length;
  const picked = picker.selected.slice(0, room);
  for (const a of picked) list.value.push({ key: ++seq, assetId: a.id, seconds: DEFAULT_SECONDS });
  if (picker.selected.length > room) ElMessage.warning(`最多 ${MAX_ITEMS} 条，只添加了前 ${room} 个`);
  picker.open = false;
}

onMounted(async () => {
  await Promise.all([loadDevices(), loadAssets()]);
  await loadPlaylist();
});
</script>

<style scoped>
.layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.side {
  width: 240px;
  flex-shrink: 0;
}
.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.side-menu {
  border-right: none;
  max-height: calc(100vh - 220px);
  overflow-y: auto;
}
.dev {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.dev-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-dev {
  padding: 12px 20px;
}
.main {
  flex: 1;
  min-width: 0;
}
.tip {
  margin-bottom: 12px;
}
.thumb {
  display: block;
  width: 96px;
  height: 54px;
  border-radius: 4px;
  background: #000;
  object-fit: contain;
}
.type-tag {
  margin-right: 6px;
}
.unit {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.danger {
  color: var(--el-color-danger);
}
</style>
