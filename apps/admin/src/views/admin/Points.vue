<template>
  <div>
    <el-tabs v-model="tab" @tab-change="onTab">
      <!-- 商家余额 -->
      <el-tab-pane label="商家余额" name="balances">
        <div class="page-head">
          <span class="muted">余额低于隐藏阈值（{{ fmtPoints(config.hideThreshold) }} 积分）的商家，其服饰不在设备展示</span>
          <el-button @click="loadMerchants">刷新</el-button>
        </div>
        <el-table v-loading="mLoading" :data="merchants" border stripe empty-text="暂无商家">
          <el-table-column prop="username" label="用户名" min-width="110" />
          <el-table-column prop="brandName" label="品牌" min-width="130" />
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="STATUS_TAG[row.status]">{{ STATUS_TEXT[row.status] || row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="余额（积分）" width="130" align="right">
            <template #default="{ row }">
              <span :class="{ danger: row.balance < 0 }">{{ fmtPoints(row.balance) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="累计试穿时长" width="130" align="center">
            <template #default="{ row }">{{ fmtDuration(row.usageMs) }}</template>
          </el-table-column>
          <el-table-column label="设备展示" width="100" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.hidden" type="danger">已隐藏</el-tag>
              <el-tag v-else type="success">展示中</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button link type="success" @click="openAdjust(row, 'add')">加积分</el-button>
              <el-button link type="warning" @click="openAdjust(row, 'deduct')">扣积分</el-button>
              <el-button link type="primary" @click="viewLedger(row)">流水</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 积分流水 -->
      <el-tab-pane label="积分流水" name="ledger">
        <div class="page-head">
          <div class="filters">
            <el-select v-model="filter.merchantId" placeholder="全部商家" clearable filterable style="width: 200px" @change="searchLedger">
              <el-option v-for="m in merchants" :key="m.merchantId" :label="`${m.brandName}（${m.username}）`" :value="m.merchantId" />
            </el-select>
            <el-select v-model="filter.type" placeholder="全部类型" clearable style="width: 150px" @change="searchLedger">
              <el-option v-for="(label, key) in LEDGER_TYPE_TEXT" :key="key" :label="label" :value="key" />
            </el-select>
          </div>
          <el-button @click="loadLedger">刷新</el-button>
        </div>
        <el-table v-loading="lLoading" :data="ledger" border stripe empty-text="暂无流水">
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="brandName" label="商家" min-width="120" />
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
          <el-table-column label="服饰 / 设备" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              <template v-if="row.garmentId">
                {{ row.garmentTitle || `服饰 #${row.garmentId}` }}
                <span v-if="row.deviceId" class="muted">· 设备 #{{ row.deviceId }}</span>
              </template>
              <template v-else>—</template>
            </template>
          </el-table-column>
          <el-table-column label="时长" width="90" align="center">
            <template #default="{ row }">{{ row.durationMs ? fmtDuration(row.durationMs) : '—' }}</template>
          </el-table-column>
          <el-table-column label="备注" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ row.note || '—' }}</template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="filter.page"
          v-model:page-size="filter.pageSize"
          class="pager"
          background
          layout="total, sizes, prev, pager, next"
          :page-sizes="[20, 50, 100]"
          :total="ledgerTotal"
          @current-change="loadLedger"
          @size-change="searchLedger"
        />
      </el-tab-pane>

      <!-- 积分配置 -->
      <el-tab-pane label="积分配置" name="config">
        <el-card shadow="never" style="max-width: 660px">
          <el-form ref="cfgRef" v-loading="cLoading" :model="cfg" :rules="cfgRules" label-width="130px" @submit.prevent="saveConfig">
            <el-form-item label="每分钟扣费" prop="pointsPerMinute">
              <el-input-number v-model="cfg.pointsPerMinute" :min="0.01" :max="100" :step="0.1" :precision="2" />
              <span class="unit">积分 / 分钟，按秒累计</span>
            </el-form-item>
            <el-form-item label="隐藏阈值" prop="hideThreshold">
              <el-input-number v-model="cfg.hideThreshold" :min="0" :max="100000" :precision="2" />
              <span class="unit">积分，余额低于此值服饰暂停展示</span>
            </el-form-item>
            <el-form-item label="单次试穿上限" prop="tryonMaxMinutes">
              <el-input-number v-model="cfg.tryonMaxMinutes" :min="1" :max="30" :step="1" :precision="0" />
              <span class="unit">分钟</span>
            </el-form-item>
            <el-form-item label="待机进入播放" prop="idleMinutes">
              <el-input-number v-model="cfg.idleMinutes" :min="1" :max="60" :step="1" :precision="0" />
              <span class="unit">分钟无操作进入广告播放；试穿中会先结束试穿</span>
            </el-form-item>
            <el-form-item label="Xmax 换算比例" prop="xmaxRatio">
              <el-input v-model.trim="cfg.xmaxRatio" maxlength="20" placeholder="平台积分 : Xmax 积分，如 1:10" style="width: 220px" />
              <span class="unit">仅总后台可见，商家不可见</span>
            </el-form-item>
            <el-form-item label="充值联系方式" prop="rechargeContact">
              <el-input v-model.trim="cfg.rechargeContact" maxlength="200" show-word-limit placeholder="如：微信 xxx / 电话 xxx" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" native-type="submit" :loading="cSaving">保存</el-button>
            </el-form-item>
          </el-form>

          <el-divider />

          <el-form label-width="130px">
            <el-form-item label="收款码">
              <div>
                <el-image
                  v-if="config.rechargeQrUrl"
                  :src="mediaUrl(config.rechargeQrUrl)"
                  :preview-src-list="[mediaUrl(config.rechargeQrUrl)]"
                  preview-teleported
                  fit="contain"
                  class="qr"
                  alt="收款码"
                />
                <div v-else class="muted">尚未上传</div>
                <div class="qr-ops">
                  <input ref="qrInput" type="file" accept="image/jpeg,image/png,image/webp" aria-label="收款码图片" hidden @change="uploadQr" />
                  <el-button :loading="qrUploading" @click="qrInput.click()">{{ config.rechargeQrUrl ? '更换收款码' : '上传收款码' }}</el-button>
                  <span class="muted">JPG / PNG / WebP，不超过 10MB；商家在“积分与充值”页看到</span>
                </div>
              </div>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 加/扣积分 -->
    <el-dialog v-model="adjust.open" :title="adjust.form.type === 'add' ? '加积分' : '扣积分'" width="460px" @closed="adjustRef?.clearValidate()">
      <p class="muted" style="margin-top: 0">
        商家：{{ adjust.row?.brandName }}（当前余额 {{ fmtPoints(adjust.row?.balance) }} 积分）
      </p>
      <el-form ref="adjustRef" :model="adjust.form" :rules="adjustRules" label-width="70px" @submit.prevent="submitAdjust">
        <el-form-item label="类型" prop="type">
          <el-radio-group v-model="adjust.form.type">
            <el-radio value="add">加积分</el-radio>
            <el-radio value="deduct">扣积分</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="数量" prop="amount">
          <el-input-number v-model="adjust.form.amount" :min="0.01" :max="1000000" :precision="2" />
          <span class="unit">积分</span>
        </el-form-item>
        <el-form-item label="备注" prop="note">
          <el-input v-model="adjust.form.note" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="必填，如：线下收款 100 元，单号 xxx" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjust.open = false">取消</el-button>
        <el-button :type="adjust.form.type === 'add' ? 'primary' : 'warning'" :loading="adjust.saving" @click="submitAdjust">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { api, mediaUrl } from '../../api.js';
import {
  LEDGER_TYPE_TAG,
  LEDGER_TYPE_TEXT,
  STATUS_TAG,
  STATUS_TEXT,
  fmtDuration,
  fmtPoints,
  fmtTime,
} from '../../store.js';

const tab = ref('balances');

// ---- 商家余额 ----
const merchants = ref([]);
const mLoading = ref(false);

async function loadMerchants() {
  mLoading.value = true;
  try {
    merchants.value = (await api('admin/points/merchants')).items;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    mLoading.value = false;
  }
}

// ---- 加/扣积分 ----
const adjustRef = ref();
const adjust = reactive({ open: false, saving: false, row: null, form: { type: 'add', amount: 100, note: '' } });
const adjustRules = {
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
  amount: [{ required: true, message: '请填写数量', trigger: 'blur' }],
  note: [
    {
      validator: (_r, v, cb) => (v && v.trim() && v.trim().length <= 200 ? cb() : cb(new Error('请填写备注（200 字以内）'))),
      trigger: 'blur',
    },
  ],
};

function openAdjust(row, type) {
  Object.assign(adjust, { open: true, saving: false, row, form: { type, amount: 100, note: '' } });
}

async function submitAdjust() {
  if (!(await adjustRef.value.validate().catch(() => false))) return;
  adjust.saving = true;
  try {
    const { type, amount, note } = adjust.form;
    const res = await api(`admin/merchants/${adjust.row.merchantId}/points`, {
      method: 'POST',
      body: { type, amount, note: note.trim() },
    });
    ElMessage.success(`已${type === 'add' ? '加' : '扣'}积分，当前余额 ${fmtPoints(res.balance)}`);
    adjust.open = false;
    await loadMerchants();
    if (tab.value === 'ledger') await loadLedger();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    adjust.saving = false;
  }
}

// ---- 流水 ----
const ledger = ref([]);
const ledgerTotal = ref(0);
const lLoading = ref(false);
const filter = reactive({ merchantId: '', type: '', page: 1, pageSize: 20 });

async function loadLedger() {
  lLoading.value = true;
  try {
    const res = await api('admin/points/ledger', { query: { ...filter } });
    ledger.value = res.items;
    ledgerTotal.value = res.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    lLoading.value = false;
  }
}

function searchLedger() {
  filter.page = 1;
  loadLedger();
}

function viewLedger(row) {
  Object.assign(filter, { merchantId: row.merchantId, type: '', page: 1 });
  tab.value = 'ledger';
  loadLedger();
}

// ---- 配置 ----
const cfgRef = ref();
const config = ref({ pointsPerMinute: 1, hideThreshold: 5, xmaxRatio: '', rechargeContact: '', rechargeQrUrl: '', tryonMaxMinutes: 5, idleMinutes: 4 });
const cfg = reactive({ pointsPerMinute: 1, hideThreshold: 5, xmaxRatio: '', rechargeContact: '', tryonMaxMinutes: 5, idleMinutes: 4 });
const cLoading = ref(false);
const cSaving = ref(false);
const cfgRules = {
  pointsPerMinute: [{ required: true, message: '请填写每分钟扣费', trigger: 'blur' }],
  hideThreshold: [{ required: true, message: '请填写隐藏阈值', trigger: 'blur' }],
  tryonMaxMinutes: [{ required: true, message: '请填写单次试穿上限', trigger: 'blur' }],
  idleMinutes: [{ required: true, message: '请填写待机进入播放时间', trigger: 'blur' }],
};

function fillConfig(c) {
  config.value = c;
  for (const k of Object.keys(cfg)) cfg[k] = c[k] ?? cfg[k];
}

async function loadConfig() {
  cLoading.value = true;
  try {
    fillConfig(await api('admin/points/config'));
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    cLoading.value = false;
  }
}

async function saveConfig() {
  if (!(await cfgRef.value.validate().catch(() => false))) return;
  cSaving.value = true;
  try {
    fillConfig(await api('admin/points/config', { method: 'PUT', body: { ...cfg } }));
    ElMessage.success('已保存');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    cSaving.value = false;
  }
}

const qrInput = ref();
const qrUploading = ref(false);

async function uploadQr(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return ElMessage.warning('仅支持 JPG / PNG / WebP');
  if (file.size > 10 * 1024 * 1024) return ElMessage.warning('图片不能超过 10MB');
  const fd = new FormData();
  fd.append('image', file);
  qrUploading.value = true;
  try {
    fillConfig(await api('admin/points/recharge-qr', { method: 'POST', body: fd }));
    ElMessage.success('收款码已更新');
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    qrUploading.value = false;
  }
}

function onTab(name) {
  if (name === 'ledger' && !ledger.value.length) loadLedger();
  if (name === 'config') loadConfig();
}

onMounted(() => {
  loadMerchants();
  loadConfig();
});
</script>

<style scoped>
.filters {
  display: flex;
  gap: 8px;
}
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.unit {
  margin-left: 10px;
  color: #8a8f99;
  font-size: 13px;
}
.danger {
  color: var(--el-color-danger);
}
.success {
  color: var(--el-color-success);
}
.qr {
  display: block;
  width: 180px;
  height: 180px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
.qr-ops {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}
</style>
