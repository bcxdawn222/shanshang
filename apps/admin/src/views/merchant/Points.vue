<template>
  <div>
    <el-alert
      v-if="info.hidden"
      type="error"
      show-icon
      :closable="false"
      class="block"
      :title="`余额低于 ${fmtPoints(info.hideThreshold)} 积分，服饰已暂停在设备展示，请充值`"
    />

    <el-row :gutter="16" class="block">
      <el-col :span="8">
        <el-card v-loading="loading" shadow="never">
          <el-statistic title="当前余额（积分）" :value="Number(info.balance ?? 0)" :precision="2" :value-style="info.balance < 0 ? { color: 'var(--el-color-danger)' } : undefined" />
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card v-loading="loading" shadow="never">
          <div class="stat-title">累计试穿时长</div>
          <div class="stat-value">{{ fmtDuration(info.usageMs) }}</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card v-loading="loading" shadow="never">
          <div class="stat-title">设备展示</div>
          <div class="stat-value">
            <el-tag v-if="info.hidden" type="danger">已暂停</el-tag>
            <el-tag v-else type="success">展示中</el-tag>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="block">
      <template #header>充值</template>
      <div class="recharge">
        <el-image v-if="recharge.qrUrl" :src="mediaUrl(recharge.qrUrl)" :preview-src-list="[mediaUrl(recharge.qrUrl)]" preview-teleported fit="contain" class="qr" alt="收款码" />
        <div>
          <p>联系方式：{{ recharge.contact || '请联系平台管理员' }}</p>
          <p class="muted">扫码付款后请联系平台，管理员确认后为你加积分。试穿按秒计费，余额低于 {{ fmtPoints(info.hideThreshold) }} 积分时服饰会暂停在设备展示。</p>
        </div>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="page-head" style="margin: 0">
          <span>积分流水</span>
          <el-button size="small" @click="refresh">刷新</el-button>
        </div>
      </template>
      <el-table v-loading="lLoading" :data="ledger" border stripe empty-text="暂无流水">
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="LEDGER_TYPE_TAG[row.type]" size="small">{{ LEDGER_TYPE_TEXT[row.type] || row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="变动" width="110" align="right">
          <template #default="{ row }">
            <span :class="row.amount < 0 ? 'danger' : 'success'">{{ fmtPoints(row.amount, true) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="变动后余额" width="110" align="right">
          <template #default="{ row }">{{ fmtPoints(row.balanceAfter) }}</template>
        </el-table-column>
        <el-table-column label="服饰" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.garmentId ? row.garmentTitle || `服饰 #${row.garmentId}` : '—' }}</template>
        </el-table-column>
        <el-table-column label="时长" width="90" align="center">
          <template #default="{ row }">{{ row.durationMs ? fmtDuration(row.durationMs) : '—' }}</template>
        </el-table-column>
        <el-table-column label="备注" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.note || '—' }}</template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        class="pager"
        background
        layout="total, sizes, prev, pager, next"
        :page-sizes="[20, 50, 100]"
        :total="total"
        @current-change="loadLedger"
        @size-change="onSize"
      />
    </el-card>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';
import { api, mediaUrl } from '../../api.js';
import { LEDGER_TYPE_TAG, LEDGER_TYPE_TEXT, fmtDuration, fmtPoints, fmtTime } from '../../store.js';

const info = ref({ balance: 0, usageMs: 0, hideThreshold: 5, hidden: false });
const recharge = ref({ contact: '', qrUrl: '' });
const loading = ref(false);

const ledger = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const lLoading = ref(false);

async function loadInfo() {
  loading.value = true;
  try {
    const [p, r] = await Promise.all([api('merchant/points'), api('merchant/recharge')]);
    info.value = p;
    recharge.value = r;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function loadLedger() {
  lLoading.value = true;
  try {
    const res = await api('merchant/points/ledger', { query: { page: page.value, pageSize: pageSize.value } });
    ledger.value = res.items;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    lLoading.value = false;
  }
}

function onSize() {
  page.value = 1;
  loadLedger();
}

function refresh() {
  loadInfo();
  loadLedger();
}

onMounted(refresh);
</script>

<style scoped>
.block {
  margin-bottom: 16px;
}
.stat-title {
  font-size: 14px;
  color: var(--el-text-color-regular);
  margin-bottom: 4px;
}
.stat-value {
  font-size: 20px;
  line-height: 32px;
}
.recharge {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}
.recharge p {
  margin: 0 0 8px;
}
.qr {
  width: 180px;
  height: 180px;
  flex: none;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.danger {
  color: var(--el-color-danger);
}
.success {
  color: var(--el-color-success);
}
</style>
