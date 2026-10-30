<template>
  <div>
    <div class="page-head">
      <span class="muted">按近 7 天试穿次数取前 {{ TOP_N }}；置顶的排最前（按置顶先后），移出的不进榜。设备只看到可展示的服饰</span>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe empty-text="暂无数据" :row-class-name="rowClass">
      <el-table-column label="排名" width="70" align="center">
        <template #default="{ row }">{{ row.rank ?? '—' }}</template>
      </el-table-column>
      <el-table-column prop="title" label="服饰" min-width="160" show-overflow-tooltip />
      <el-table-column prop="brandName" label="品牌" min-width="120" show-overflow-tooltip />
      <el-table-column label="近 7 天试穿" width="110" align="right">
        <template #default="{ row }">{{ row.tryonCount ?? 0 }} 次</template>
      </el-table-column>
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.removed" type="info">已移出</el-tag>
          <el-tag v-else-if="row.pinned" type="danger">置顶</el-tag>
          <el-tag v-else-if="row.rank" type="success">在榜</el-tag>
          <el-tag v-else type="info" effect="plain">未进前 {{ TOP_N }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <template v-if="row.removed">
            <el-button link type="primary" :loading="busy === row.garmentId" @click="act(row, 'restore')">恢复</el-button>
          </template>
          <template v-else>
            <el-button v-if="row.pinned" link type="warning" :loading="busy === row.garmentId" @click="act(row, 'unpin')">取消置顶</el-button>
            <el-button v-else link type="primary" :loading="busy === row.garmentId" @click="act(row, 'pin')">置顶</el-button>
            <el-button link type="danger" :disabled="busy === row.garmentId" @click="act(row, 'remove')">移出</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';

const TOP_N = 20;
const OK_TEXT = { pin: '已置顶', unpin: '已取消置顶', remove: '已移出热门榜', restore: '已恢复' };

const items = ref([]);
const loading = ref(false);
const busy = ref(null);

// 服务端已按榜单顺序返回（含被移出的）；排名只给未移出的前 20
const rows = computed(() => {
  let n = 0;
  return items.value.map((g) => {
    if (g.removed) return { ...g, rank: null };
    n += 1;
    return { ...g, rank: n <= TOP_N ? n : null };
  });
});

const rowClass = ({ row }) => (row.removed ? 'row-removed' : '');

async function load() {
  loading.value = true;
  try {
    items.value = (await api('admin/hot')).items;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function act(row, action) {
  if (action === 'remove') {
    const ok = await ElMessageBox.confirm(`把「${row.title}」移出热门榜？之后试穿次数再高也不会进榜，可随时恢复。`, '移出热门榜', {
      type: 'warning',
    }).catch(() => false);
    if (!ok) return;
  }
  busy.value = row.garmentId;
  try {
    await api(`admin/hot/${row.garmentId}`, { method: 'POST', body: { action } });
    ElMessage.success(OK_TEXT[action]);
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    busy.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
:deep(.row-removed) {
  color: #a8abb2;
}
</style>
