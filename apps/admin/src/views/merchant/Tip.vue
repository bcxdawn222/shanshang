<template>
  <el-card v-loading="loading" shadow="never" style="max-width: 420px">
    <div class="tip">
      <el-image
        v-if="qrUrl"
        :src="mediaUrl(qrUrl)"
        :preview-src-list="[mediaUrl(qrUrl)]"
        preview-teleported
        fit="contain"
        class="qr"
        alt="打赏收款码"
      />
      <div v-else class="muted">平台尚未上传打赏码</div>
      <p class="muted">觉得好用可以扫码打赏作者，金额随意。打赏与积分充值无关，不会增加积分。</p>
    </div>
  </el-card>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';
import { api, mediaUrl } from '../../api.js';

const qrUrl = ref('');
const loading = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    qrUrl.value = (await api('merchant/tip')).qrUrl;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.tip {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.qr {
  width: 240px;
  height: 240px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}
</style>
