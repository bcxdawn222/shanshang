<template>
  <div class="redeem">
    <el-card shadow="never" class="block">
      <template #header>核销短码</template>
      <el-form class="lookup" @submit.prevent="lookupByCode">
        <el-input
          v-model.trim="code"
          maxlength="6"
          inputmode="numeric"
          placeholder="输入顾客出示的 6 位短码"
          aria-label="核销短码"
          clearable
          class="code-input"
          @input="code = code.replace(/\D/g, '')"
        />
        <el-button type="primary" native-type="submit" :loading="looking">查询</el-button>
      </el-form>
      <p class="muted tip">也可以用已登录的手机扫顾客快照页底部的“商家核销”，打开后直接确认。</p>

      <div v-if="snap" v-loading="looking" class="snap">
        <el-image
          v-if="snap.imageUrl"
          :src="mediaUrl(snap.imageUrl)"
          :preview-src-list="[mediaUrl(snap.imageUrl)]"
          preview-teleported
          fit="cover"
          class="thumb"
          alt="试穿快照"
        />
        <div v-else class="thumb empty">图片已清理</div>
        <el-descriptions :column="1" border class="desc">
          <el-descriptions-item label="短码">{{ snap.code }}</el-descriptions-item>
          <el-descriptions-item label="服饰">{{ snap.garmentTitle || '—' }}</el-descriptions-item>
          <el-descriptions-item label="生成时间">{{ fmtTime(snap.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="过期时间">{{ fmtTime(snap.expiresAt) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="SNAPSHOT_STATE_TAG[snap.state]">{{ SNAPSHOT_STATE_TEXT[snap.state] || snap.state }}</el-tag>
            <span v-if="snap.redeemedAt" class="muted" style="margin-left: 8px">{{ fmtTime(snap.redeemedAt) }} 核销</span>
          </el-descriptions-item>
        </el-descriptions>
        <el-button
          type="primary"
          size="large"
          class="confirm"
          :disabled="snap.state !== 'valid'"
          :loading="redeeming"
          @click="redeem"
        >
          {{ snap.state === 'valid' ? '确认核销' : SNAPSHOT_STATE_TEXT[snap.state] || '不可核销' }}
        </el-button>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="page-head" style="margin: 0">
          <span>核销记录</span>
          <el-button size="small" @click="loadRecords">刷新</el-button>
        </div>
      </template>
      <el-table v-loading="rLoading" :data="records" border stripe empty-text="暂无核销记录">
        <el-table-column label="核销时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.redeemedAt) }}</template>
        </el-table-column>
        <el-table-column prop="code" label="短码" width="90" align="center" />
        <el-table-column label="服饰" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.garmentTitle || '—' }}</template>
        </el-table-column>
        <el-table-column label="生成时间" width="150" class-name="wide-only" label-class-name="wide-only">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
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
        @current-change="loadRecords"
        @size-change="onSize"
      />
    </el-card>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, mediaUrl } from '../../api.js';
import { SNAPSHOT_STATE_TAG, SNAPSHOT_STATE_TEXT, fmtTime } from '../../store.js';

const route = useRoute();
const router = useRouter();

const code = ref('');
const snap = ref(null);
// 当前查询凭据：{ code } 或 { token }（手机扫码进来带 token），核销时原样提交
const target = ref(null);
const looking = ref(false);
const redeeming = ref(false);

const records = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const rLoading = ref(false);

async function lookup(body) {
  looking.value = true;
  try {
    snap.value = await api('merchant/redeem/lookup', { method: 'POST', body });
    target.value = body;
  } catch (e) {
    // 不存在 / 跨商家 / 限流等，按服务端 message 提示
    snap.value = null;
    target.value = null;
    ElMessage.error(e.message);
  } finally {
    looking.value = false;
  }
}

function lookupByCode() {
  if (!/^\d{6}$/.test(code.value)) {
    ElMessage.warning('请输入 6 位数字短码');
    return;
  }
  // 手输短码后去掉地址里的 token，避免刷新又查回扫码那张
  if (route.query.token) router.replace({ query: {} });
  lookup({ code: code.value });
}

async function redeem() {
  redeeming.value = true;
  try {
    snap.value = await api('merchant/redeem', { method: 'POST', body: target.value });
    ElMessage.success('核销成功');
    code.value = '';
    page.value = 1;
    loadRecords();
  } catch (e) {
    ElMessage.error(e.message);
    // 重复 / 过期：刷新一下状态，按钮随之置灰
    if (e.status === 409 || e.status === 410) lookup(target.value);
  } finally {
    redeeming.value = false;
  }
}

async function loadRecords() {
  rLoading.value = true;
  try {
    const res = await api('merchant/redemptions', { query: { page: page.value, pageSize: pageSize.value } });
    records.value = res.items;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    rLoading.value = false;
  }
}

function onSize() {
  page.value = 1;
  loadRecords();
}

// 扫码进来：?token=<token> 直接查询（同页再次扫码时 query 变化也会触发）
watch(
  () => route.query.token,
  (token) => {
    if (typeof token === 'string' && token) lookup({ token });
  },
  { immediate: true },
);

onMounted(loadRecords);
</script>

<style scoped>
.redeem {
  max-width: 900px;
}
.block {
  margin-bottom: 16px;
}
.lookup {
  display: flex;
  gap: 12px;
}
.code-input {
  max-width: 260px;
  font-size: 18px;
  letter-spacing: 4px;
}
.tip {
  margin: 8px 0 0;
}
.snap {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
  margin-top: 16px;
}
.thumb {
  width: 160px;
  height: 213px;
  flex: none;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}
.thumb.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  background: var(--el-fill-color-light);
}
.desc {
  flex: 1;
  min-width: 260px;
}
.confirm {
  width: 100%;
}
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
/* 手机扫码打开：图片居中、输入框占满、表格只留关键列 */
@media (max-width: 768px) {
  .code-input {
    max-width: none;
    flex: 1;
  }
  .snap {
    justify-content: center;
  }
  .desc {
    min-width: 100%;
  }
  .pager {
    justify-content: center;
  }
  :deep(.wide-only) {
    display: none;
  }
}
</style>
