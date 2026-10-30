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

    <el-card v-if="account.status === 'approved'" shadow="never" class="card">
      <template #header>资料设置</template>
      <el-form :model="form" label-width="96px" style="max-width: 520px" @submit.prevent="save">
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
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { STATUS_TAG, STATUS_TEXT, fmtTime, store } from '../../store.js';

const account = ref(null);
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
</style>
