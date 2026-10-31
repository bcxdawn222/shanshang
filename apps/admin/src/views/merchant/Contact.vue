<template>
  <el-card v-loading="loading" shadow="never" style="max-width: 620px">
    <el-descriptions :column="1" border>
      <el-descriptions-item label="联系电话">{{ info.phone || '—' }}</el-descriptions-item>
      <el-descriptions-item label="地址">{{ info.address || '—' }}</el-descriptions-item>
      <el-descriptions-item label="微信二维码">
        <el-image
          v-if="info.wechatQrUrl"
          :src="mediaUrl(info.wechatQrUrl)"
          :preview-src-list="[mediaUrl(info.wechatQrUrl)]"
          preview-teleported
          fit="contain"
          class="qr"
          alt="平台微信二维码"
        />
        <span v-else class="muted">平台尚未上传</span>
      </el-descriptions-item>
    </el-descriptions>
    <p class="muted">有问题也可以在“留言反馈”里留言，管理员回复后会显示在留言列表里。</p>
  </el-card>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';
import { api, mediaUrl } from '../../api.js';

const info = ref({ phone: '', address: '', wechatQrUrl: '' });
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    info.value = await api('merchant/contact');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.qr {
  width: 180px;
  height: 180px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}
</style>
