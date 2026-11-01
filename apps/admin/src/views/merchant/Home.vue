<template>
  <div v-if="account">
    <el-result
      v-if="account.status === 'pending'"
      icon="info"
      title="账号审核中"
      sub-title="平台审核通过后即可上传服饰，请耐心等待或联系平台管理员。"
    />
    <el-result
      v-else-if="account.status === 'rejected'"
      icon="error"
      title="注册未通过审核"
      :sub-title="`原因：${m.reviewNote || '未填写'}。如有疑问请联系平台管理员。`"
    />

    <el-alert
      v-if="points?.hidden"
      type="error"
      show-icon
      :closable="false"
      class="card"
      :title="`余额低于 ${fmtPoints(points.hideThreshold)} 积分，服饰已暂停在设备展示，请充值`"
    />

    <!-- 统计卡片：宽屏一行三块，窄屏一块一行 -->
    <el-row v-if="account.status === 'approved' && points" :gutter="16">
      <el-col :xs="24" :sm="8">
        <el-card shadow="never" class="card">
          <div class="stat-title">当前余额</div>
          <div class="stat-value" :style="points.balance < 0 ? { color: 'var(--el-color-danger)' } : undefined">
            {{ fmtPoints(points.balance) }} <span class="stat-unit">积分</span>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="8">
        <el-card shadow="never" class="card">
          <div class="stat-title">累计试穿时长</div>
          <div class="stat-value">{{ fmtDuration(points.usageMs) }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="8">
        <el-card shadow="never" class="card">
          <div class="stat-title">积分与充值</div>
          <div class="stat-value">
            <el-button type="primary" link @click="router.push('/merchant/points')">查看流水 / 去充值</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 账号信息 + 资料设置：宽屏左右并排，窄屏上下堆叠 -->
    <el-row :gutter="16">
      <el-col :xs="24" :lg="account.status === 'approved' ? 14 : 24">
        <el-card shadow="never" class="card">
          <template #header>账号信息</template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="用户名">{{ account.username }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="STATUS_TAG[account.status]">{{ STATUS_TEXT[account.status] }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="品牌名称">
              {{ m.brandName }}
              <span class="muted">（如需修改请联系管理员）</span>
            </el-descriptions-item>
            <el-descriptions-item label="服饰格位">{{ m.slotQuota }} 格</el-descriptions-item>
            <el-descriptions-item label="联系方式">{{ m.contact || '—' }}</el-descriptions-item>
            <el-descriptions-item label="注册时间">{{ fmtTime(account.createdAt) }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>

      <el-col v-if="account.status === 'approved'" :xs="24" :lg="10">
        <el-card shadow="never" class="card">
          <template #header>资料设置</template>
          <el-form :model="form" label-width="80px" @submit.prevent="save">
            <el-form-item label="昵称">
              <el-input v-model.trim="form.nickname" maxlength="30" />
            </el-form-item>
            <el-form-item label="店铺位置">
              <el-input v-model.trim="form.shopLocation" maxlength="60" placeholder="如：3F-A12 某某女装，试穿时显示在屏幕角落" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" native-type="submit" :loading="saving">保存</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { useRouter } from 'vue-router';
import { STATUS_TAG, STATUS_TEXT, fmtDuration, fmtPoints, fmtTime, store } from '../../store.js';

const router = useRouter();
const account = ref(null);
const points = ref(null);
const m = computed(() => account.value?.merchant ?? {});
const form = reactive({ nickname: '', shopLocation: '' });
const saving = ref(false);

function fill(a) {
  account.value = a;
  store.account = { ...store.account, ...a };
  form.nickname = a.nickname;
  form.shopLocation = a.merchant.shopLocation;
}

onMounted(async () => {
  try {
    fill((await api('merchant/profile')).account);
  } catch (e) {
    ElMessage.error(e.message);
    return;
  }
  // 积分接口只对已审核商家开放；失败不打扰（服务端未就绪时也不影响概览）
  if (account.value?.status === 'approved') {
    points.value = await api('merchant/points').catch(() => null);
  }
});

async function save() {
  if (!form.nickname) {
    ElMessage.warning('昵称不能为空');
    return;
  }
  saving.value = true;
  try {
    fill((await api('merchant/profile', { method: 'PUT', body: { ...form } })).account);
    ElMessage.success('已保存');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.card {
  margin-bottom: 16px;
}
.stat-title {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.stat-value {
  margin-top: 8px;
  font-size: 22px;
  font-weight: 600;
  line-height: 32px;
}
.stat-unit {
  font-size: 13px;
  font-weight: 400;
}
</style>
