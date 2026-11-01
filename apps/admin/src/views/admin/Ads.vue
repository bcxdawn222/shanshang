<template>
  <div>
    <div class="page-head">
      <span class="muted">图片 JPG / PNG / WebP 不超过 10MB；视频 MP4 / WebM 不超过 200MB。素材需加入“播放列表”才会在设备播放</span>
      <div>
        <el-button @click="load">刷新</el-button>
        <el-button type="primary" @click="openUpload">上传素材</el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="items" border stripe empty-text="暂无素材">
      <el-table-column label="预览" width="200">
        <template #default="{ row }">
          <el-image
            v-if="row.type === 'image'"
            :src="mediaUrl(row.url)"
            :preview-src-list="[mediaUrl(row.url)]"
            preview-teleported
            fit="cover"
            class="thumb"
            :alt="row.name"
          />
          <video v-else :src="mediaUrl(row.url)" controls muted preload="metadata" class="thumb" :aria-label="row.name" />
        </template>
      </el-table-column>
      <el-table-column label="类型" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="row.type === 'video' ? 'primary' : 'success'" size="small">{{ TYPE_TEXT[row.type] || row.type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="名称" min-width="160" show-overflow-tooltip />
      <el-table-column label="大小" width="100" align="right">
        <template #default="{ row }">{{ fmtSize(row.sizeBytes) }}</template>
      </el-table-column>
      <el-table-column label="上传时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog.open" title="上传素材" width="520px" :close-on-click-modal="false" :before-close="beforeClose" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px" @submit.prevent="submit">
        <el-form-item label="名称" prop="name">
          <el-input v-model.trim="form.name" maxlength="60" show-word-limit placeholder="如：双十一主视觉 15 秒" :disabled="dialog.uploading" />
        </el-form-item>
        <el-form-item label="文件" prop="file">
          <div class="file-box">
            <input
              ref="fileInput"
              type="file"
              :accept="ACCEPT"
              aria-label="素材文件"
              :disabled="dialog.uploading"
              @change="onFile"
            />
            <div v-if="form.file" class="muted">{{ TYPE_TEXT[form.type] }} · {{ fmtSize(form.file.size) }}</div>
            <img v-if="preview && form.type === 'image'" :src="preview" alt="预览" class="preview" />
            <video v-else-if="preview" :src="preview" controls muted class="preview" aria-label="视频预览" />
          </div>
        </el-form-item>
        <el-form-item v-if="dialog.uploading || dialog.progress" label="进度">
          <el-progress :percentage="dialog.progress" :status="dialog.progress === 100 ? 'success' : undefined" style="width: 100%" />
          <div v-if="dialog.progress === 100 && dialog.uploading" class="muted">上传完成，服务器处理中…</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cancel">{{ dialog.uploading ? '取消上传' : '取消' }}</el-button>
        <el-button type="primary" :loading="dialog.uploading" @click="submit">上传</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { api, apiUpload, mediaUrl } from '../../api.js';
import { fmtTime } from '../../store.js';

const TYPE_TEXT = { image: '图片', video: '视频' };
const MB = 1024 * 1024;
// 前端校验口径（接口约定 Phase 4 §1），服务端仍会按文件头再校验
const RULES = {
  image: { mimes: ['image/jpeg', 'image/png', 'image/webp'], exts: ['jpg', 'jpeg', 'png', 'webp'], max: 10 * MB, maxText: '10MB' },
  video: { mimes: ['video/mp4', 'video/webm'], exts: ['mp4', 'webm'], max: 200 * MB, maxText: '200MB' },
};
const ACCEPT = [...RULES.image.mimes, ...RULES.video.mimes].join(',');

const items = ref([]);
const loading = ref(false);

function fmtSize(bytes) {
  const n = Number(bytes || 0);
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  return `${Math.max(Math.round(n / 1024), 1)} KB`;
}

async function load() {
  loading.value = true;
  try {
    items.value = (await api('admin/ads/assets')).items;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function remove(row) {
  const ok = await ElMessageBox.confirm(`删除素材「${row.name}」？删除后不可恢复。`, '删除素材', {
    type: 'warning',
    confirmButtonClass: 'el-button--danger',
  }).catch(() => false);
  if (!ok) return;
  try {
    await api(`admin/ads/assets/${row.id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    ElMessage.error(e.code === 'ASSET_IN_USE' ? '素材正在播放列表中使用，请先移除' : e.message);
  }
}

// ---------- 上传 ----------
const formRef = ref();
const fileInput = ref();
const preview = ref('');
const dialog = reactive({ open: false, uploading: false, progress: 0 });
const form = reactive({ name: '', file: null, type: '' });
const rules = {
  name: [{ required: true, message: '请填写名称', trigger: 'blur' }],
  file: [{ required: true, message: '请选择文件', trigger: 'change' }],
};
let controller = null;

function openUpload() {
  dialog.open = true;
}

function detectType(file) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return Object.keys(RULES).find((t) => RULES[t].mimes.includes(file.type) && RULES[t].exts.includes(ext)) ?? '';
}

function onFile(e) {
  const file = e.target.files?.[0] ?? null;
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = '';
  form.file = null;
  form.type = '';
  dialog.progress = 0;
  if (file) {
    const type = detectType(file);
    if (!type) {
      e.target.value = '';
      ElMessage.warning('仅支持图片 JPG / PNG / WebP，视频 MP4 / WebM');
    } else if (file.size > RULES[type].max) {
      e.target.value = '';
      ElMessage.warning(`${TYPE_TEXT[type]}不能超过 ${RULES[type].maxText}`);
    } else {
      form.file = file;
      form.type = type;
      preview.value = URL.createObjectURL(file);
      // 名称留空时默认取文件名
      if (!form.name) form.name = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
    }
  }
  formRef.value?.validateField('file');
}

function resetForm() {
  Object.assign(form, { name: '', file: null, type: '' });
  Object.assign(dialog, { uploading: false, progress: 0 });
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = '';
  if (fileInput.value) fileInput.value.value = '';
  formRef.value?.clearValidate();
}

function cancel() {
  if (dialog.uploading) controller?.abort();
  else dialog.open = false;
}

// 上传中点 × 或 Esc：先确认再取消
async function beforeClose(done) {
  if (!dialog.uploading) return done();
  const ok = await ElMessageBox.confirm('正在上传，确定取消？', '取消上传', { type: 'warning' }).catch(() => false);
  if (ok) {
    controller?.abort();
    done();
  }
}

async function submit() {
  if (dialog.uploading) return;
  if (!(await formRef.value.validate().catch(() => false))) return;
  const fd = new FormData();
  // 文本字段放在文件前，服务端流式读取时先拿到 name
  fd.append('name', form.name);
  fd.append('file', form.file);
  controller = new AbortController();
  Object.assign(dialog, { uploading: true, progress: 0 });
  try {
    await apiUpload('admin/ads/assets', fd, { onProgress: (p) => (dialog.progress = p), signal: controller.signal });
    ElMessage.success('上传成功');
    dialog.open = false;
    await load();
  } catch (e) {
    if (e.code === 'ABORTED') ElMessage.info(e.message);
    else ElMessage.error(e.message);
    dialog.progress = 0;
  } finally {
    dialog.uploading = false;
    controller = null;
  }
}

onMounted(load);
</script>

<style scoped>
.thumb {
  display: block;
  width: 168px;
  height: 96px;
  border-radius: 4px;
  background: #000;
  object-fit: contain;
}
.file-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preview {
  max-width: 360px;
  max-height: 200px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: #000;
}
</style>
