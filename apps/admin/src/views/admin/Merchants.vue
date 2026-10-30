<template>
  <div>
    <div class="page-head">
      <el-radio-group v-model="status" @change="load">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="pending">待审核</el-radio-button>
        <el-radio-button value="approved">已通过</el-radio-button>
        <el-radio-button value="rejected">已驳回</el-radio-button>
        <el-radio-button value="disabled">已停用</el-radio-button>
      </el-radio-group>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="items" border stripe empty-text="暂无商家">
      <el-table-column prop="username" label="用户名" min-width="110" />
      <el-table-column label="品牌" min-width="130">
        <template #default="{ row }">{{ row.merchant.brandName }}</template>
      </el-table-column>
      <el-table-column label="联系方式" min-width="120">
        <template #default="{ row }">{{ row.merchant.contact || '—' }}</template>
      </el-table-column>
      <el-table-column label="格位" width="70" align="center">
        <template #default="{ row }">{{ row.merchant.slotQuota }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="STATUS_TAG[row.status]">{{ STATUS_TEXT[row.status] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="审核备注" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">{{ row.merchant.reviewNote || '—' }}</template>
      </el-table-column>
      <el-table-column label="注册时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'pending' || row.status === 'rejected'">
            <el-button link type="success" @click="approve(row)">通过</el-button>
          </template>
          <el-button v-if="row.status === 'pending'" link type="danger" @click="reject(row)">驳回</el-button>
          <el-button v-if="row.status !== 'disabled'" link type="warning" @click="disable(row)">停用</el-button>
          <el-button v-else link type="primary" @click="act(row, 'enable', '已启用')">启用</el-button>
          <el-button link @click="resetPassword(row)">重置密码</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { STATUS_TAG, STATUS_TEXT, fmtTime } from '../../store.js';

const status = ref('pending');
const items = ref([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    items.value = (await api('admin/merchants', { query: { status: status.value } })).items;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function act(row, action, okText, body) {
  try {
    await api(`admin/merchants/${row.id}/${action}`, { method: 'POST', body: body ?? {} });
    ElMessage.success(okText);
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function approve(row) {
  const res = await ElMessageBox.prompt(`通过「${row.merchant.brandName}」的入驻申请？通过后默认 18 个服饰格。`, '审核通过', {
    inputPlaceholder: '备注（选填）',
    inputValidator: (v) => (v ?? '').length <= 200 || '备注最多 200 字',
  }).catch(() => null);
  if (res) await act(row, 'approve', '已通过', { note: res.value ?? '' });
}

async function reject(row) {
  const res = await ElMessageBox.prompt(`驳回「${row.merchant.brandName}」，原因会展示给商家。`, '驳回', {
    inputPlaceholder: '驳回原因（必填）',
    inputValidator: (v) => (v && v.trim() && v.length <= 200) || '请填写原因（200 字以内）',
    confirmButtonClass: 'el-button--danger',
  }).catch(() => null);
  if (res) await act(row, 'reject', '已驳回', { note: res.value.trim() });
}

async function disable(row) {
  const ok = await ElMessageBox.confirm(
    `停用后「${row.merchant.brandName}」将无法登录，已登录的会话立即失效。`,
    '停用商家',
    { type: 'warning' },
  ).catch(() => false);
  if (ok) await act(row, 'disable', '已停用');
}

async function resetPassword(row) {
  const ok = await ElMessageBox.confirm(`重置「${row.username}」的密码？对方所有登录会话会立即失效。`, '重置密码', {
    type: 'warning',
  }).catch(() => false);
  if (!ok) return;
  try {
    const { temporaryPassword } = await api(`admin/merchants/${row.id}/reset-password`, { method: 'POST' });
    // 临时密码只显示这一次，服务端不保存明文
    await ElMessageBox.alert(`临时密码：${temporaryPassword}\n\n只显示这一次，请转告商家登录后立即修改。`, '已重置', {
      confirmButtonText: '我已记下',
    });
  } catch (e) {
    ElMessage.error(e.message);
  }
}

onMounted(load);
</script>
