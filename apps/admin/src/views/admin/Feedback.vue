<template>
  <div>
    <div class="page-head">
      <div class="filters">
        <el-radio-group v-model="filter.status" @change="search">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="pending">待处理（{{ pending }}）</el-radio-button>
          <el-radio-button value="replied">已回复</el-radio-button>
        </el-radio-group>
        <el-select v-model="filter.merchantId" placeholder="全部商家" clearable filterable style="width: 200px" @change="search">
          <el-option v-for="m in merchants" :key="m.merchantId" :label="`${m.brandName}（${m.username}）`" :value="m.merchantId" />
        </el-select>
      </div>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="items" border stripe empty-text="暂无留言">
      <el-table-column label="时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="商家" min-width="130" show-overflow-tooltip>
        <template #default="{ row }">{{ row.brandName || `商家 #${row.merchantId}` }}<span class="muted">（{{ row.username }}）</span></template>
      </el-table-column>
      <el-table-column label="留言" min-width="220">
        <template #default="{ row }"><div class="text">{{ row.content }}</div></template>
      </el-table-column>
      <el-table-column label="回复" min-width="200">
        <template #default="{ row }">
          <div v-if="row.reply" class="text">{{ row.reply }}</div>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="FEEDBACK_STATUS_TAG[row.status]" size="small">{{ FEEDBACK_STATUS_TEXT[row.status] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openReply(row)">{{ row.status === 'replied' ? '改回复' : '回复' }}</el-button>
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

    <el-dialog v-model="dlg.open" title="回复留言" width="520px">
      <p class="muted" style="margin-top: 0">{{ dlg.row?.brandName }}：</p>
      <div class="text quote">{{ dlg.row?.content }}</div>
      <el-input v-model="dlg.reply" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="回复内容，商家在“留言反馈”页可见" aria-label="回复内容" />
      <template #footer>
        <el-button @click="dlg.open = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="submitReply">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { FEEDBACK_STATUS_TAG, FEEDBACK_STATUS_TEXT, fmtTime } from '../../store.js';

const merchants = ref([]);
const items = ref([]);
const total = ref(0);
const pending = ref(0);
const loading = ref(false);
const filter = reactive({ status: '', merchantId: '', page: 1, pageSize: 20 });
const dlg = reactive({ open: false, saving: false, row: null, reply: '' });

async function load() {
  loading.value = true;
  try {
    const res = await api('admin/feedback', { query: { ...filter } });
    items.value = res.items;
    total.value = res.total;
    pending.value = res.pending;
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

function openReply(row) {
  Object.assign(dlg, { open: true, saving: false, row, reply: row.reply || '' });
}

async function submitReply() {
  const text = dlg.reply.trim();
  if (!text) return ElMessage.warning('请填写回复内容');
  dlg.saving = true;
  try {
    await api(`admin/feedback/${dlg.row.id}/reply`, { method: 'POST', body: { reply: text } });
    ElMessage.success('已回复');
    dlg.open = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    dlg.saving = false;
  }
}

onMounted(async () => {
  load();
  try {
    merchants.value = (await api('admin/points/merchants')).items;
  } catch (e) {
    ElMessage.error(e.message);
  }
});
</script>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
.quote {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
