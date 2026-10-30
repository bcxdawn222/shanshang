<template>
  <el-card shadow="never" style="max-width: 480px">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" @submit.prevent="submit">
      <el-form-item :label="`原${word}`" prop="oldPassword">
        <el-input v-model="form.oldPassword" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item :label="`新${word}`" prop="newPassword">
        <el-input v-model="form.newPassword" type="password" show-password autocomplete="new-password" />
      </el-form-item>
      <el-form-item :label="`确认新${word}`" prop="confirm">
        <el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading">保存</el-button>
        <span class="muted" style="margin-left: 12px">修改后其他设备上的登录会全部退出</span>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { computed, reactive, ref } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';

const word = computed(() => (store.account?.role === 'admin' ? '口令' : '密码'));
const minLen = computed(() => (store.account?.role === 'admin' ? 12 : 8));
const formRef = ref();
const form = reactive({ oldPassword: '', newPassword: '', confirm: '' });
const loading = ref(false);

const rules = {
  oldPassword: [{ required: true, message: '请填写', trigger: 'blur' }],
  newPassword: [
    {
      validator: (_r, v, cb) =>
        v && v.length >= minLen.value && v.length <= 64 ? cb() : cb(new Error(`长度 ${minLen.value}~64 位`)),
      trigger: 'blur',
    },
  ],
  confirm: [
    { validator: (_r, v, cb) => (v === form.newPassword ? cb() : cb(new Error('两次输入不一致'))), trigger: 'blur' },
  ],
};

async function submit() {
  if (!(await formRef.value.validate().catch(() => false))) return;
  loading.value = true;
  try {
    await api('auth/password', {
      method: 'POST',
      body: { oldPassword: form.oldPassword, newPassword: form.newPassword },
    });
    ElMessage.success('已修改');
    formRef.value.resetFields();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}
</script>
