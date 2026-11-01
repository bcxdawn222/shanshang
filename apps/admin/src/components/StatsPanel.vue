<template>
  <div>
    <div class="page-head">
      <div class="filters">
        <el-date-picker
          v-model="range"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :clearable="false"
          :disabled-date="disabledDate"
          style="width: 260px"
          @change="load"
        />
        <template v-if="admin">
          <el-select v-model="filter.merchantId" placeholder="全部商家" clearable filterable style="width: 200px" @change="load">
            <el-option v-for="m in merchants" :key="m.merchantId" :label="`${m.brandName}（${m.username}）`" :value="m.merchantId" />
          </el-select>
          <el-select v-model="filter.deviceId" placeholder="全部设备" clearable filterable style="width: 180px" @change="load">
            <el-option v-for="d in devices" :key="d.id" :label="d.name || d.code" :value="d.id" />
          </el-select>
        </template>
      </div>
      <div>
        <el-button @click="load">刷新</el-button>
        <el-button type="primary" :loading="exporting" @click="onExport">导出 Excel</el-button>
      </div>
    </div>

    <el-row v-loading="loading" :gutter="16" class="block">
      <el-col v-for="c in CARDS" :key="c.key" :xs="12" :sm="8" :lg="4">
        <el-card shadow="never" class="card">
          <div class="stat-title">{{ c.label }}</div>
          <div class="stat-value">{{ c.duration ? fmtDuration(totals[c.key]) : totals[c.key] ?? 0 }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="block">
      <template #header>
        <div class="page-head" style="margin: 0">
          <span>按日趋势（北京时间）</span>
          <el-radio-group v-model="metric" size="small">
            <el-radio-button v-for="c in CARDS" :key="c.key" :value="c.key">{{ c.label }}</el-radio-button>
          </el-radio-group>
        </div>
      </template>
      <StatsChart :data="chartData" :label="current.label" :integer="!current.duration" :format="current.duration ? fmtDuration : String" />
    </el-card>

    <el-card v-if="admin" shadow="never" class="block">
      <template #header>按商家</template>
      <el-table :data="data.byMerchant || []" border stripe empty-text="暂无数据">
        <el-table-column label="商家" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.brandName || `商家 #${row.merchantId}` }}<span class="muted">（{{ row.username }}）</span></template>
        </el-table-column>
        <el-table-column v-for="c in CARDS" :key="c.key" :label="c.label" min-width="110" align="right">
          <template #default="{ row }">{{ c.duration ? fmtDuration(row[c.key]) : row[c.key] }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>按服饰</template>
      <el-table :data="data.byGarment" border stripe empty-text="暂无数据">
        <el-table-column label="服饰" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.garmentTitle || `服饰 #${row.garmentId}` }}
            <el-tag v-if="row.garmentDeleted" size="small" type="info">已删除</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="admin" prop="brandName" label="品牌" min-width="120" show-overflow-tooltip />
        <el-table-column v-for="c in GARMENT_COLS" :key="c.key" :label="c.label" min-width="110" align="right">
          <template #default="{ row }">{{ c.duration ? fmtDuration(row[c.key]) : row[c.key] }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { api, apiDownload } from '../api.js';
import { fmtDuration } from '../store.js';
import StatsChart from './StatsChart.vue';

const props = defineProps({
  // true：总后台全局统计（可按商家、设备筛选）；false：商家看自己
  admin: { type: Boolean, default: false },
});

const CARDS = [
  { key: 'brandClicks', label: '品牌点击次数' },
  { key: 'brandDwellMs', label: '品牌停留时长', duration: true },
  { key: 'tryonCount', label: '服饰试穿次数' },
  { key: 'tryonMs', label: '服饰试穿时长', duration: true },
  { key: 'redeemCount', label: '核销件数' },
  { key: 'recommendCount', label: '被 AI 推荐次数' },
];
// 品牌点击 / 停留是品牌级指标，不按服饰拆分
const GARMENT_COLS = CARDS.filter((c) => !c.key.startsWith('brand'));
const MAX_DAYS = 366;
const DAY_MS = 24 * 3600_000;

/** 北京时间的今天 YYYY-MM-DD，offset 为往前推的天数 */
function shanghaiDay(offset = 0) {
  return new Date(Date.now() + 8 * 3600_000 - offset * DAY_MS).toISOString().slice(0, 10);
}

const range = ref([shanghaiDay(29), shanghaiDay(0)]);
const filter = reactive({ merchantId: '', deviceId: '' });
const metric = ref('tryonCount');
const loading = ref(false);
const exporting = ref(false);
const data = ref({ totals: {}, daily: [], byGarment: [], byMerchant: [] });
const merchants = ref([]);
const devices = ref([]);

const totals = computed(() => data.value.totals || {});
const current = computed(() => CARDS.find((c) => c.key === metric.value));
const chartData = computed(() => data.value.daily.map((d) => ({ day: d.day, value: d[metric.value] })));
const disabledDate = (d) => d.getTime() > Date.now();

const base = computed(() => (props.admin ? 'admin/stats' : 'merchant/stats'));
function query() {
  const [from, to] = range.value || [];
  const q = { from, to };
  if (props.admin) Object.assign(q, filter);
  return q;
}

function checkRange() {
  const [from, to] = range.value || [];
  if (!from || !to) return false;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  if (days > MAX_DAYS) {
    ElMessage.warning(`日期范围最多 ${MAX_DAYS} 天`);
    return false;
  }
  return true;
}

async function load() {
  if (!checkRange()) return;
  loading.value = true;
  try {
    data.value = await api(base.value, { query: query() });
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function onExport() {
  if (!checkRange()) return;
  exporting.value = true;
  try {
    await apiDownload(`${base.value}/export`, { query: query(), filename: '数据统计.xls' });
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    exporting.value = false;
  }
}

onMounted(async () => {
  load();
  if (props.admin) {
    try {
      const [m, d] = await Promise.all([api('admin/points/merchants'), api('admin/devices')]);
      merchants.value = m.items;
      devices.value = d.items;
    } catch (e) {
      ElMessage.error(e.message);
    }
  }
});
</script>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.block {
  margin-bottom: 16px;
}
.card {
  margin-bottom: 16px;
}
.stat-title {
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin-bottom: 4px;
}
.stat-value {
  font-size: 22px;
  line-height: 32px;
  font-weight: 600;
}
</style>
