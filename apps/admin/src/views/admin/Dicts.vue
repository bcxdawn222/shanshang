<template>
  <div>
    <div class="page-head">
      <el-radio-group v-model="kind">
        <el-radio-button v-for="(label, key) in KINDS" :key="key" :value="key">{{ label }}</el-radio-button>
      </el-radio-group>
      <el-button type="primary" @click="add">新增{{ KINDS[kind] }}</el-button>
    </div>
    <p class="muted">停用后商家上传时不能再选，已上架服饰不受影响。标签不能删除，避免已有服饰丢失分类。</p>

    <el-table v-loading="loading" :data="rows" border stripe empty-text="暂无数据" style="max-width: 640px">
      <el-table-column prop="name" label="名称" min-width="160" />
      <el-table-column label="启用" width="100" align="center">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :aria-label="`启用 ${row.name}`" @change="(v) => update(row, { enabled: v })" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button link type="primary" @click="rename(row)">改名</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';

const KINDS = { category: '品类', scene: '场景', color: '主色' };
const kind = ref('category');
const items = ref([]);
const loading = ref(false);
const rows = computed(() => items.value.filter((d) => d.kind === kind.value));

async function load() {
  loading.value = true;
  try {
    items.value = (await api('admin/dicts')).items;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

const nameInput = {
  inputValidator: (v) => (v && v.trim() && v.trim().length <= 20) || '请填写名称（20 字以内）',
};

async function add() {
  const res = await ElMessageBox.prompt(`新增${KINDS[kind.value]}`, '新增', nameInput).catch(() => null);
  if (!res) return;
  try {
    await api('admin/dicts', { method: 'POST', body: { kind: kind.value, name: res.value.trim() } });
    ElMessage.success('已新增');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function rename(row) {
  const res = await ElMessageBox.prompt('新名称', '改名', { ...nameInput, inputValue: row.name }).catch(() => null);
  if (res) await update(row, { name: res.value.trim() });
}

async function update(row, body) {
  try {
    await api(`admin/dicts/${row.id}`, { method: 'PATCH', body });
    ElMessage.success('已保存');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

onMounted(load);
</script>
