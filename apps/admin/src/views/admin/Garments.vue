<template>
  <div>
    <div class="page-head">
      <el-radio-group v-model="status" @change="load">
        <el-radio-button value="reviewing">审核期</el-radio-button>
        <el-radio-button value="ready">已上架</el-radio-button>
        <el-radio-button value="rejected">已驳回</el-radio-button>
        <el-radio-button value="offline">已下架</el-radio-button>
        <el-radio-button value="">全部</el-radio-button>
      </el-radio-group>
      <el-button @click="load">刷新</el-button>
    </div>
    <p class="muted">审核期内无人处理，到时间自动上架；可以提前通过或驳回。</p>

    <el-table v-loading="loading" :data="items" border stripe empty-text="暂无服饰">
      <el-table-column label="图片" width="96">
        <template #default="{ row }">
          <el-image
            :src="mediaUrl(row.imagePath)"
            :preview-src-list="[mediaUrl(row.imagePath)]"
            preview-teleported
            fit="cover"
            class="thumb"
            :alt="row.title"
          />
        </template>
      </el-table-column>
      <el-table-column prop="brandName" label="商家" min-width="110" />
      <el-table-column prop="title" label="名称" min-width="140" show-overflow-tooltip />
      <el-table-column label="标签" min-width="200">
        <template #default="{ row }">
          {{ GENDER[row.gender] }} · {{ SET_TYPE[row.setType] }} · {{ row.category }} · {{ row.color }}
          <div v-if="row.scenes.length" class="muted">{{ row.scenes.join('、') }}</div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110" align="center">
        <template #default="{ row }">
          <el-tag :type="TAG[row.status]">{{ statusText(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="上架时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.availableAt) }}</template>
      </el-table-column>
      <el-table-column label="试穿图" width="90" align="center">
        <template #default="{ row }">
          <el-tooltip :content="row.xmaxReady ? '已转存到试穿服务' : '未转存，设备首次试穿时上传'" placement="top">
            <el-tag :type="row.xmaxReady ? 'success' : 'info'" size="small">{{ row.xmaxReady ? '已就绪' : '待上传' }}</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">{{ row.reviewNote || '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button v-if="canApprove(row)" link type="success" @click="approve(row)">
            {{ row.status === 'reviewing' ? '提前通过' : '恢复上架' }}
          </el-button>
          <el-button v-if="row.status === 'reviewing' || row.status === 'ready'" link type="danger" @click="reject(row)">驳回</el-button>
          <el-button v-if="row.status === 'reviewing' || row.status === 'ready'" link type="warning" @click="offline(row)">下架</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, ref } from 'vue';
import { api, mediaUrl } from '../../api.js';
import { fmtTime } from '../../store.js';

const GENDER = { female: '女', male: '男', kid: '童' };
const SET_TYPE = { suit: '套装', single: '单品' };
const TAG = { reviewing: 'warning', ready: 'success', rejected: 'danger', offline: 'info' };

const status = ref('reviewing');
const items = ref([]);
const loading = ref(false);

function statusText(g) {
  if (g.status === 'reviewing') return '审核期';
  if (g.status === 'ready') return '已上架';
  if (g.status === 'rejected') return '已驳回';
  return g.offlineBy === 'admin' ? '平台下架' : '商家下架';
}

const canApprove = (g) => g.status === 'reviewing' || g.status === 'rejected' || (g.status === 'offline' && g.offlineBy === 'admin');

async function load() {
  loading.value = true;
  try {
    items.value = (await api('admin/garments', { query: { status: status.value } })).items;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function act(row, action, okText, body = {}) {
  try {
    await api(`admin/garments/${row.id}/${action}`, { method: 'POST', body });
    ElMessage.success(okText);
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function approve(row) {
  const ok = await ElMessageBox.confirm(`「${row.brandName}」的「${row.title}」立即上架到设备？`, '通过', { type: 'info' }).catch(() => false);
  if (ok) await act(row, 'approve', '已上架');
}

async function reject(row) {
  const res = await ElMessageBox.prompt(`驳回「${row.title}」，原因会展示给商家。`, '驳回', {
    inputPlaceholder: '驳回原因（必填）',
    inputValidator: (v) => (v && v.trim() && v.length <= 200) || '请填写原因（200 字以内）',
    confirmButtonClass: 'el-button--danger',
  }).catch(() => null);
  if (res) await act(row, 'reject', '已驳回', { note: res.value.trim() });
}

async function offline(row) {
  const ok = await ElMessageBox.confirm(`下架「${row.title}」？平台下架后商家不能自行恢复。`, '下架', { type: 'warning' }).catch(() => false);
  if (ok) await act(row, 'offline', '已下架');
}

onMounted(load);
</script>

<style scoped>
.thumb {
  width: 64px;
  height: 64px;
  border-radius: 4px;
}
</style>
