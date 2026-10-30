<template>
  <AuthFrame title="商家注册">
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
      <el-form-item label="用户名" prop="username">
        <el-input v-model.trim="form.username" placeholder="3~32 位字母、数字、下划线" autocomplete="username" />
      </el-form-item>
      <el-form-item label="密码" prop="password">
        <el-input v-model="form.password" type="password" show-password placeholder="至少 8 位" autocomplete="new-password" />
      </el-form-item>
      <el-form-item label="确认密码" prop="confirm">
        <el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" />
      </el-form-item>
      <el-form-item label="品牌名称" prop="brandName">
        <el-input v-model.trim="form.brandName" maxlength="40" placeholder="设备上展示的品牌名，提交后不能自行修改" />
      </el-form-item>
      <el-form-item label="联系方式" prop="contact">
        <el-input v-model.trim="form.contact" maxlength="60" placeholder="手机号或微信，方便审核联系" />
      </el-form-item>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="err" />
      <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%">提交注册</el-button>
    </el-form>
    <div class="links">已有账号？<router-link to="/merchant/login">去登录</router-link></div>
  </AuthFrame>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import AuthFrame from '../components/AuthFrame.vue';
import { store } from '../store.js';

const router = useRouter();
const formRef = ref();
const form = reactive({ username: '', password: '', confirm: '', brandName: '', contact: '' });
const loading = ref(false);
const error = ref('');

// 与服务端 schema 保持一致
const rules = {
  username: [{ required: true, pattern: /^[A-Za-z0-9_]{3,32}$/, message: '3~32 位字母、数字、下划线', trigger: 'blur' }],
  password: [{ required: true, min: 8, max: 64, message: '密码 8~64 位', trigger: 'blur' }],
  confirm: [
    {
      validator: (_r, v, cb) => (v === form.password ? cb() : cb(new Error('两次密码不一致'))),
      trigger: 'blur',
    },
  ],
  brandName: [{ required: true, message: '请填写品牌名称', trigger: 'blur' }],
};

async function submit() {
  if (!(await formRef.value.validate().catch(() => false))) return;
  loading.value = true;
  error.value = '';
  try {
    const { confirm, ...body } = form;
    const { account } = await api('auth/merchant/register', { method: 'POST', body });
    store.account = account;
    router.replace('/merchant');
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
