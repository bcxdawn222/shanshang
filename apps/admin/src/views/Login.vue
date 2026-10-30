<template>
  <AuthFrame :title="isAdmin ? '总后台登录' : '商家登录'">
    <el-form :model="form" @submit.prevent="submit" label-position="top">
      <el-form-item :label="isAdmin ? '管理员账号' : '用户名'">
        <el-input v-model.trim="form.username" autocomplete="username" />
      </el-form-item>
      <el-form-item :label="isAdmin ? '登录口令' : '密码'">
        <el-input v-model="form.password" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="err" />
      <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%">登录</el-button>
    </el-form>
    <div v-if="!isAdmin" class="links">
      还没有账号？<router-link to="/merchant/register">注册商家</router-link>
    </div>
  </AuthFrame>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import AuthFrame from '../components/AuthFrame.vue';
import { store } from '../store.js';

const props = defineProps({ role: { type: String, required: true } });
const isAdmin = computed(() => props.role === 'admin');
const router = useRouter();
const form = reactive({ username: '', password: '' });
const loading = ref(false);
const error = ref('');

async function submit() {
  if (!form.username || !form.password) {
    error.value = '请填写完整';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const { account } = await api(`auth/${props.role}/login`, { method: 'POST', body: form });
    store.account = account;
    router.replace(isAdmin.value ? '/admin' : '/merchant');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.err {
  margin-bottom: 12px;
}
.links {
  margin-top: 14px;
  text-align: center;
  font-size: 13px;
  color: #888;
}
</style>
