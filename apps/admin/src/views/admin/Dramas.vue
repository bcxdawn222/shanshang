<template>
  <div>
    <div class="page-head">
      <span class="muted">设备“热播短剧同款”只展示已启用的专题，以及其中设备可见的服饰；排序数字小的在前</span>
      <div>
        <el-button @click="load">刷新</el-button>
        <el-button type="primary" @click="openCreate">新建专题</el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="items" border stripe empty-text="暂无专题">
      <el-table-column label="海报" width="100">
        <template #default="{ row }">
          <el-image
            v-if="row.posterUrl"
            :src="mediaUrl(row.posterUrl)"
            :preview-src-list="[mediaUrl(row.posterUrl)]"
            preview-teleported
            fit="cover"
            class="poster"
            :alt="row.title"
          />
        </template>
      </el-table-column>
      <el-table-column prop="title" label="剧名" min-width="140" show-overflow-tooltip />
      <el-table-column label="同款服饰" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <span>{{ row.garmentIds?.length || 0 }} 件</span>
          <span class="muted" style="margin-left: 8px">{{ garmentNames(row.garmentIds) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="sort" label="排序" width="80" align="center" />
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog.open" :title="dialog.id ? '编辑专题' : '新建专题'" width="600px" :close-on-click-modal="false" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px" @submit.prevent="submit">
        <el-form-item label="剧名" prop="title">
          <el-input v-model.trim="form.title" maxlength="40" show-word-limit placeholder="如：繁花" />
        </el-form-item>
        <el-form-item label="海报" prop="poster">
          <div class="file-box">
            <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" aria-label="海报图片" @change="onFile" />
            <div class="muted">JPG / PNG / WebP，不超过 10MB{{ dialog.id ? '；不选则保留原海报' : '' }}</div>
            <img v-if="preview || dialog.posterUrl" :src="preview || mediaUrl(dialog.posterUrl)" alt="海报预览" class="preview" />
          </div>
        </el-form-item>
        <el-form-item label="同款服饰" prop="garmentIds">
          <el-select
            v-model="form.garmentIds"
            multiple
            filterable
            clearable
            :loading="gLoading"
            placeholder="搜索服饰名称或品牌，可多选"
            style="width: 100%"
          >
            <el-option v-for="g in garmentOptions" :key="g.id" :label="g.label" :value="g.id">
              <div class="opt">
                <img v-if="g.imagePath" :src="mediaUrl(g.imagePath)" alt="" class="opt-img" />
                <span>{{ g.label }}</span>
              </div>
            </el-option>
          </el-select>
          <div class="muted">只能选已上架的服饰；已下架的服饰设备上不显示</div>
        </el-form-item>
        <el-form-item label="排序" prop="sort">
          <el-input-number v-model="form.sort" :min="0" :max="9999" :step="1" :precision="0" />
          <span class="unit">数字小的在前</span>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.open = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { api, mediaUrl } from '../../api.js';

const items = ref([]);
const loading = ref(false);

// ---- 可选服饰（已上架） ----
const garments = ref([]);
const gLoading = ref(false);
const garmentMap = computed(() => new Map(garments.value.map((g) => [g.id, g])));

async function loadGarments() {
  gLoading.value = true;
  try {
    garments.value = (await api('admin/garments', { query: { status: 'ready' } })).items;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    gLoading.value = false;
  }
}

// 已选但不在上架列表里的服饰也要能显示和取消
const garmentOptions = computed(() => {
  const opts = garments.value.map((g) => ({ id: g.id, label: `${g.title}（${g.brandName}）`, imagePath: g.imagePath }));
  for (const id of form.garmentIds) {
    if (!garmentMap.value.has(id)) opts.push({ id, label: `服饰 #${id}（未上架）`, imagePath: '' });
  }
  return opts;
});

function garmentNames(ids = []) {
  return ids
    .map((id) => garmentMap.value.get(id)?.title)
    .filter(Boolean)
    .join('、');
}

async function load() {
  loading.value = true;
  try {
    items.value = (await api('admin/dramas')).items;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function remove(row) {
  const ok = await ElMessageBox.confirm(`删除专题「${row.title}」？服饰本身不受影响。`, '删除专题', {
    type: 'warning',
    confirmButtonClass: 'el-button--danger',
  }).catch(() => false);
  if (!ok) return;
  try {
    await api(`admin/dramas/${row.id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

// ---- 新建 / 编辑 ----
const formRef = ref();
const fileInput = ref();
const preview = ref('');
const dialog = reactive({ open: false, id: null, posterUrl: '', saving: false });
const blank = () => ({ title: '', poster: null, garmentIds: [], sort: 0, enabled: true });
const form = reactive(blank());
const rules = {
  title: [{ required: true, message: '请填写剧名', trigger: 'blur' }],
  poster: [
    {
      validator: (_r, v, cb) => (v || dialog.posterUrl ? cb() : cb(new Error('请上传海报'))),
      trigger: 'change',
    },
  ],
  garmentIds: [{ type: 'array', required: true, min: 1, message: '至少选 1 件同款服饰', trigger: 'change' }],
};

function openCreate() {
  Object.assign(dialog, { open: true, id: null, posterUrl: '', saving: false });
  loadGarments();
}

function openEdit(row) {
  Object.assign(dialog, { open: true, id: row.id, posterUrl: row.posterUrl || '', saving: false });
  Object.assign(form, {
    title: row.title,
    poster: null,
    garmentIds: [...(row.garmentIds || [])],
    sort: row.sort ?? 0,
    enabled: row.enabled !== false,
  });
  loadGarments();
}

function onFile(e) {
  const file = e.target.files?.[0] ?? null;
  if (file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    e.target.value = '';
    return ElMessage.warning('仅支持 JPG / PNG / WebP');
  }
  if (file && file.size > 10 * 1024 * 1024) {
    e.target.value = '';
    return ElMessage.warning('图片不能超过 10MB');
  }
  form.poster = file;
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = file ? URL.createObjectURL(file) : '';
  formRef.value?.validateField('poster');
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
  // 文本字段放在文件前，服务端流式读取时先拿到
  fd.append('title', form.title);
  fd.append('garmentIds', JSON.stringify(form.garmentIds));
  fd.append('sort', String(form.sort ?? 0));
  fd.append('enabled', String(form.enabled));
  if (form.poster) fd.append('poster', form.poster);
  dialog.saving = true;
  try {
    if (dialog.id) await api(`admin/dramas/${dialog.id}`, { method: 'PATCH', body: fd });
    else await api('admin/dramas', { method: 'POST', body: fd });
    ElMessage.success('已保存');
    dialog.open = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    dialog.saving = false;
  }
}

onMounted(() => {
  load();
  loadGarments();
});
</script>

<style scoped>
.poster {
  width: 60px;
  height: 80px;
  border-radius: 4px;
}
.file-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.preview {
  width: 120px;
  height: 160px;
  object-fit: cover;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}
.opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.opt-img {
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: 2px;
}
.unit {
  margin-left: 10px;
  color: #8a8f99;
  font-size: 13px;
}
</style>
