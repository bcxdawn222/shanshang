<template>
  <div>
    <div class="page-head">
      <div>
        <span>服饰格位：已用 {{ slots.used }} / {{ slots.quota }}</span>
        <span class="muted" style="margin-left: 12px">格位用完请联系管理员加格</span>
      </div>
      <div>
        <el-button @click="noTrainPermission">服饰训练</el-button>
        <el-button @click="load">刷新</el-button>
      </div>
    </div>

    <div v-loading="loading" class="grid">
      <el-card v-for="g in items" :key="g.id" shadow="hover" class="cell" :body-style="{ padding: '0' }">
        <img :src="mediaUrl(g.imagePath)" :alt="g.title" class="thumb" />
        <div class="info">
          <div class="name" :title="g.title">{{ g.title }}</div>
          <div class="tags">
            {{ dicts.genders?.[g.gender] }} · {{ dicts.setTypes?.[g.setType] }} · {{ g.category }} · {{ g.color }}
          </div>
          <el-tag :type="GARMENT_TAG[g.status]" size="small">{{ statusText(g) }}</el-tag>
          <template v-if="g.status === 'reviewing'">
            <div class="countdown">{{ countdown(g.availableAt) }}</div>
            <div class="notice">{{ TRAIN_NOTICE }}</div>
          </template>
          <div v-if="g.status === 'rejected'" class="notice danger">驳回原因：{{ g.reviewNote || '未填写' }}</div>
          <div class="ops">
            <el-button v-if="g.status === 'reviewing' || g.status === 'ready'" link type="warning" @click="act(g, 'offline', '已下架')">
              下架
            </el-button>
            <el-button v-if="g.status === 'offline' && g.offlineBy !== 'admin'" link type="primary" @click="act(g, 'online', '已重新上架')">
              上架
            </el-button>
            <el-button link type="danger" @click="remove(g)">删除</el-button>
          </div>
        </div>
      </el-card>

      <!-- 格位内的空格：点击上传 -->
      <div v-for="n in emptySlots" :key="`empty-${n}`" class="cell add" role="button" tabindex="0" @click="openUpload" @keyup.enter="openUpload">
        <el-icon :size="32"><Plus /></el-icon>
        <span>上传服饰</span>
      </div>
      <!-- 格位已满：再点“+”提示联系管理员（GAR-02） -->
      <div v-if="emptySlots === 0" class="cell add locked" role="button" tabindex="0" @click="contactAdmin" @keyup.enter="contactAdmin">
        <el-icon :size="32"><Plus /></el-icon>
        <span>添加更多格位</span>
      </div>
    </div>

    <el-dialog v-model="dialog" title="上传服饰" width="560px" :close-on-click-modal="false" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="服饰图片" prop="file">
          <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" aria-label="服饰图片" @change="onFile" />
          <div class="muted">JPG / PNG / WebP，不超过 10MB；建议平铺或模特正面图，背景干净</div>
          <img v-if="preview" :src="preview" alt="预览" class="preview" />
        </el-form-item>
        <el-form-item label="名称" prop="title">
          <el-input v-model.trim="form.title" maxlength="40" placeholder="如：法式碎花连衣裙" />
        </el-form-item>
        <el-form-item label="性别" prop="gender">
          <el-radio-group v-model="form.gender">
            <el-radio v-for="(label, key) in dicts.genders" :key="key" :value="key">{{ label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="类型" prop="setType">
          <el-radio-group v-model="form.setType">
            <el-radio v-for="(label, key) in dicts.setTypes" :key="key" :value="key">{{ label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="品类" prop="categoryId">
          <el-select v-model="form.categoryId" placeholder="请选择">
            <el-option v-for="d in dicts.category" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="主色" prop="colorId">
          <el-select v-model="form.colorId" placeholder="请选择">
            <el-option v-for="d in dicts.color" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="场景标签">
          <el-select v-model="form.sceneIds" multiple :multiple-limit="10" placeholder="选填，可多选">
            <el-option v-for="d in dicts.scene" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="折扣说明">
          <el-input v-model.trim="form.discountText" maxlength="60" placeholder="选填，如：凭此码 9 折" />
        </el-form-item>
        <el-form-item label="店铺位置">
          <el-input v-model.trim="form.shopLocation" maxlength="60" placeholder="选填，留空用账号概览里的店铺位置" />
        </el-form-item>
      </el-form>
      <p class="notice">{{ TRAIN_NOTICE }}</p>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="submit">上传</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { api, mediaUrl } from '../../api.js';

// 文案按产品原文（GAR-06、SET-05）
const TRAIN_NOTICE = '上传服饰需要等待1-2小时的训练周期，所用时长视情况而定，最长不超过2小时。';
const GARMENT_TAG = { reviewing: 'warning', ready: 'success', rejected: 'danger', offline: 'info' };

const items = ref([]);
const slots = ref({ quota: 0, used: 0 });
const dicts = ref({});
const loading = ref(false);
const nowMs = ref(Date.now());
const emptySlots = computed(() => Math.max(slots.value.quota - slots.value.used, 0));

function statusText(g) {
  if (g.status === 'reviewing') return '训练中';
  if (g.status === 'ready') return '已上架';
  if (g.status === 'rejected') return '未通过';
  return g.offlineBy === 'admin' ? '平台已下架' : '已下架';
}

function countdown(availableAt) {
  const left = availableAt - nowMs.value;
  if (left <= 0) return '即将可用，请刷新';
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return `剩余 ${m} 分 ${String(s).padStart(2, '0')} 秒`;
}

async function load() {
  loading.value = true;
  try {
    const res = await api('merchant/garments');
    items.value = res.items;
    slots.value = res.slots;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function noTrainPermission() {
  ElMessageBox.alert('你的账户没有权限，请联系管理员', '服饰训练', { type: 'warning' });
}

function contactAdmin() {
  ElMessageBox.alert('请联系管理员', '格位已用完', { type: 'info' });
}

async function act(g, action, okText) {
  try {
    await api(`merchant/garments/${g.id}/${action}`, { method: 'POST' });
    ElMessage.success(okText);
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function remove(g) {
  const ok = await ElMessageBox.confirm(`删除「${g.title}」？删除后释放 1 个格位，不能恢复。`, '删除服饰', {
    type: 'warning',
  }).catch(() => false);
  if (!ok) return;
  try {
    await api(`merchant/garments/${g.id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

// ---------- 上传 ----------

const dialog = ref(false);
const uploading = ref(false);
const formRef = ref();
const fileInput = ref();
const preview = ref('');
const blank = () => ({
  file: null,
  title: '',
  gender: 'female',
  setType: 'single',
  categoryId: null,
  colorId: null,
  sceneIds: [],
  discountText: '',
  shopLocation: '',
});
const form = reactive(blank());
const required = (message) => ({ required: true, message, trigger: 'change' });
const rules = {
  file: [required('请选择服饰图片')],
  title: [required('请填写名称')],
  gender: [required('请选择性别')],
  setType: [required('请选择类型')],
  categoryId: [required('请选择品类')],
  colorId: [required('请选择主色')],
};

function openUpload() {
  dialog.value = true;
}

function onFile(e) {
  const file = e.target.files?.[0] ?? null;
  if (file && file.size > 10 * 1024 * 1024) {
    ElMessage.warning('图片不能超过 10MB');
    e.target.value = '';
    return;
  }
  form.file = file;
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = file ? URL.createObjectURL(file) : '';
  formRef.value?.validateField('file');
}

function resetForm() {
  Object.assign(form, blank());
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = '';
  if (fileInput.value) fileInput.value.value = '';
  formRef.value?.clearValidate();
}

async function submit() {
  if (!(await formRef.value.validate().catch(() => false))) return;
  const fd = new FormData();
  for (const key of ['title', 'gender', 'setType', 'categoryId', 'colorId', 'discountText', 'shopLocation']) {
    fd.append(key, String(form[key] ?? ''));
  }
  fd.append('sceneIds', form.sceneIds.join(','));
  fd.append('image', form.file);
  uploading.value = true;
  try {
    await api('merchant/garments', { method: 'POST', body: fd });
    ElMessage.success('上传成功，进入训练周期');
    dialog.value = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    uploading.value = false;
  }
}

let timer;
onMounted(async () => {
  timer = setInterval(() => (nowMs.value = Date.now()), 1000);
  try {
    dicts.value = await api('dicts');
  } catch (e) {
    ElMessage.error(e.message);
  }
  await load();
});
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 14px;
  min-height: 120px;
}
.cell {
  min-height: 300px;
}
.thumb {
  display: block;
  width: 100%;
  height: 180px;
  object-fit: cover;
  background: #f0f2f5;
}
.info {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}
.name {
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tags {
  font-size: 12px;
  color: #606266;
}
.countdown {
  font-size: 13px;
  color: #e6a23c;
}
.notice {
  font-size: 12px;
  color: #8a8f99;
  line-height: 1.5;
  margin: 0;
}
.notice.danger {
  color: #f56c6c;
}
.ops {
  margin-top: 2px;
}
.add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed #dcdfe6;
  border-radius: 6px;
  color: #909399;
  cursor: pointer;
  background: #fff;
}
.add:hover,
.add:focus-visible {
  border-color: #409eff;
  color: #409eff;
  outline: none;
}
.add.locked {
  background: #fafafa;
}
.preview {
  display: block;
  max-width: 160px;
  max-height: 160px;
  margin-top: 8px;
  border-radius: 4px;
}
</style>
