<template>
  <el-card v-loading="loading" shadow="never" style="max-width: 660px">
    <el-form :model="form" label-width="110px" @submit.prevent="save">
      <el-form-item label="联系电话">
        <el-input v-model.trim="form.contactPhone" maxlength="50" placeholder="商家在“联系我们”页看到" />
      </el-form-item>
      <el-form-item label="地址">
        <el-input v-model.trim="form.contactAddress" maxlength="200" show-word-limit />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" native-type="submit" :loading="saving">保存</el-button>
      </el-form-item>
    </el-form>

    <el-divider />

    <el-form label-width="110px">
      <el-form-item v-for="q in QRS" :key="q.kind" :label="q.label">
        <div>
          <el-image
            v-if="info[q.field]"
            :src="mediaUrl(info[q.field])"
            :preview-src-list="[mediaUrl(info[q.field])]"
            preview-teleported
            fit="contain"
            class="qr"
            :alt="q.label"
          />
          <div v-else class="muted">尚未上传</div>
          <div class="ops">
            <input
              :ref="(el) => (inputs[q.kind] = el)"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              :aria-label="q.label"
              hidden
              @change="(e) => upload(q.kind, e)"
            />
            <el-button :loading="uploading === q.kind" @click="inputs[q.kind].click()">{{ info[q.field] ? '更换' : '上传' }}</el-button>
            <span class="muted">JPG / PNG / WebP，不超过 10MB；{{ q.tip }}</span>
          </div>
        </div>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { api, apiUpload, mediaUrl } from '../../api.js';

const QRS = [
  { kind: 'wechat', field: 'wechatQrUrl', label: '微信二维码', tip: '显示在商家“联系我们”页' },
  { kind: 'tip', field: 'tipQrUrl', label: '打赏码', tip: '显示在商家“打赏作者”页，不接在线支付' },
];

const info = ref({ contactPhone: '', contactAddress: '', wechatQrUrl: '', tipQrUrl: '' });
const form = reactive({ contactPhone: '', contactAddress: '' });
const loading = ref(false);
const saving = ref(false);
const uploading = ref('');
const inputs = {};

function apply(data) {
  info.value = data;
  form.contactPhone = data.contactPhone;
  form.contactAddress = data.contactAddress;
}

onMounted(async () => {
  loading.value = true;
  try {
    apply(await api('admin/site-extras'));
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
});

async function save() {
  saving.value = true;
  try {
    apply(await api('admin/site-extras', { method: 'PUT', body: { ...form } }));
    ElMessage.success('已保存');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

async function upload(kind, e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) return ElMessage.warning('图片不能超过 10MB');
  const body = new FormData();
  body.append('image', file);
  uploading.value = kind;
  try {
    apply(await apiUpload(`admin/site-extras/qr?kind=${kind}`, body));
    ElMessage.success('已上传');
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    uploading.value = '';
  }
}
</script>

<style scoped>
.qr {
  width: 160px;
  height: 160px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}
.ops {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
</style>
