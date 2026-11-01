<template>
  <div>
    <div class="page-head">
      <div class="filters">
        <el-select v-model="filter.merchantId" placeholder="全部商家" clearable filterable style="width: 200px" @change="search">
          <el-option v-for="m in merchants" :key="m.merchantId" :label="`${m.brandName}（${m.username}）`" :value="m.merchantId" />
        </el-select>
        <el-radio-group v-model="filter.state" @change="search">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button v-for="(label, key) in SNAPSHOT_STATE_TEXT" :key="key" :value="key">{{ label }}</el-radio-button>
        </el-radio-group>
      </div>
      <el-button @click="load">刷新</el-button>
    </div>

    <!-- 只读，用于排查（接口约定 Phase 5 §6） -->
    <el-table v-loading="loading" :data="items" border stripe empty-text="暂无快照">
      <el-table-column label="生成时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column prop="code" label="短码" width="90" align="center" />
      <el-table-column label="商家" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ row.brandName || `商家 #${row.merchantId}` }}</template>
      </el-table-column>
      <el-table-column label="服饰" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">{{ row.garmentTitle || `服饰 #${row.garmentId}` }}</template>
      </el-table-column>
      <el-table-column label="设备" min-width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ row.deviceName || (row.deviceId ? `设备 #${row.deviceId}` : '—') }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="SNAPSHOT_STATE_TAG[row.state]" size="small">{{ SNAPSHOT_STATE_TEXT[row.state] || row.state }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="过期时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.expiresAt) }}</template>
      </el-table-column>
      <el-table-column label="核销时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.redeemedAt) }}</template>
      </el-table-column>
      <el-table-column label="图片" width="100" align="center">
        <template #default="{ row }">
          <span v-if="row.purgedAt" class="muted">已清理</span>
          <span v-else-if="!row.hasImage" class="muted">未上传</span>
          <span v-else>有</span>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="filter.page"
      v-model:page-size="filter.pageSize"
      class="pager"
      background
      layout="total, sizes, prev, pager, next"
      :page-sizes="[20, 50, 100]"
      :total="total"
      @current-change="load"
      @size-change="search"
    />
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { SNAPSHOT_STATE_TAG, SNAPSHOT_STATE_TEXT, fmtTime } from '../../store.js';

const merchants = ref([]);
const items = ref([]);
const total = ref(0);
const loading = ref(false);
const filter = reactive({ merchantId: '', state: '', page: 1, pageSize: 20 });

async function load() {
  loading.value = true;
  try {
    const res = await api('admin/snapshots', { query: { ...filter } });
    items.value = res.items;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function search() {
  filter.page = 1;
  load();
}

onMounted(async () => {
  load();
  // 商家下拉复用积分管理的商家列表；拿不到不影响列表
  merchants.value = (await api('admin/points/merchants').catch(() => null))?.items ?? [];
});
</script>

<style scoped>
.filters {
  display: flex;
  gap: 12px;
  align-items: center;
}
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
