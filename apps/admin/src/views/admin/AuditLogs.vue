<template>
  <div>
    <el-table v-loading="loading" :data="items" border stripe empty-text="暂无日志">
      <el-table-column label="时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作人" width="110">
        <template #default="{ row }">{{ row.actor || '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130">
        <template #default="{ row }">{{ ACTION_TEXT[row.action] || row.action }}</template>
      </el-table-column>
      <el-table-column label="对象" width="110">
        <template #default="{ row }">{{ row.targetType ? `${row.targetType} #${row.targetId}` : '—' }}</template>
      </el-table-column>
      <el-table-column label="详情" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ row.detail ? JSON.stringify(row.detail) : '' }}</template>
      </el-table-column>
      <el-table-column prop="ip" label="IP" width="130" />
    </el-table>
    <div class="more">
      <el-button v-if="hasMore" :loading="loading" @click="load(true)">加载更多</el-button>
      <span v-else-if="items.length" class="muted">没有更多了</span>
    </div>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { fmtTime } from '../../store.js';

const PAGE = 50;
const ACTION_TEXT = {
  'admin.login': '管理员登录',
  'merchant.approve': '审核通过',
  'merchant.reject': '审核驳回',
  'merchant.disable': '停用商家',
  'merchant.enable': '启用商家',
  'merchant.reset_password': '重置密码',
  'device.bind': '绑定设备',
  'device.update': '编辑设备',
  'device.disable': '停用设备',
  'device.enable': '启用设备',
  'settings.update': '修改平台设置',
  'account.password_change': '修改密码',
};

const items = ref([]);
const loading = ref(false);
const hasMore = ref(false);

async function load(more = false) {
  loading.value = true;
  try {
    const beforeId = more ? items.value.at(-1)?.id : undefined;
    const page = (await api('admin/audit-logs', { query: { limit: PAGE, beforeId } })).items;
    items.value = more ? [...items.value, ...page] : page;
    hasMore.value = page.length === PAGE;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());
</script>

<style scoped>
.more {
  margin-top: 12px;
  text-align: center;
}
</style>
