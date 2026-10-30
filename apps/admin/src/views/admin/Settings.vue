<template>
  <el-card shadow="never" style="max-width: 620px">
    <el-form :model="form" label-width="100px" @submit.prevent="save">
      <el-form-item label="平台名称">
        <el-input v-model.trim="form.platformName" maxlength="20" />
      </el-form-item>
      <el-form-item label="Logo 地址">
        <el-input v-model.trim="form.logoUrl" placeholder="留空用默认占位；http(s) 地址或站内路径" />
      </el-form-item>
      <el-form-item label="登录页背景">
        <el-input v-model.trim="form.loginBgUrl" placeholder="留空用渐变占位；http(s) 地址或站内路径" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" native-type="submit" :loading="saving">保存</el-button>
        <span class="muted" style="margin-left: 12px">商家端只读，不能修改</span>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { store } from '../../store.js';

const form = reactive({ platformName: '', logoUrl: '', loginBgUrl: '' });
const saving = ref(false);
const URL_RE = /^(|https?:\/\/\S+|\/\S*)$/;

onMounted(async () => {
  try {
    Object.assign(form, await api('admin/settings'));
  } catch (e) {
    ElMessage.error(e.message);
  }
});

async function save() {
  if (!form.platformName) return ElMessage.warning('平台名称不能为空');
  if (!URL_RE.test(form.logoUrl) || !URL_RE.test(form.loginBgUrl)) {
    return ElMessage.warning('图片地址需为 http(s) 地址或以 / 开头的站内路径');
  }
  saving.value = true;
  try {
    Object.assign(store.settings, await api('admin/settings', { method: 'PUT', body: { ...form } }));
    ElMessage.success('已保存');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}
</script>
