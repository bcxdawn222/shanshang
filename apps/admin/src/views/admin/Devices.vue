<template>
  <div>
    <div class="page-head">
      <span class="muted">新设备开机后屏幕上会显示 8 位设备码，录入后才能试穿</span>
      <div>
        <el-button @click="load">刷新</el-button>
        <el-button type="primary" @click="openBind()">绑定设备</el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="items" border stripe empty-text="暂无设备">
      <el-table-column prop="code" label="设备码" width="120">
        <template #default="{ row }"><code>{{ row.code }}</code></template>
      </el-table-column>
      <el-table-column label="名称" min-width="120">
        <template #default="{ row }">{{ row.name || '—' }}</template>
      </el-table-column>
      <el-table-column label="摆放地点" min-width="140">
        <template #default="{ row }">{{ row.location || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="STATUS_TAG[row.status]">{{ row.status === 'pending' ? '待绑定' : STATUS_TEXT[row.status] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="最后在线" width="150">
        <template #default="{ row }">{{ fmtTime(row.lastSeenAt) }}</template>
      </el-table-column>
      <el-table-column label="绑定时间" width="150">
        <template #default="{ row }">{{ fmtTime(row.boundAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'pending'" link type="primary" @click="openBind(row)">绑定</el-button>
          <el-button v-if="row.boundAt" link @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status !== 'disabled'" link type="warning" @click="toggle(row, 'disable')">停用</el-button>
          <el-button v-else link type="primary" @click="toggle(row, 'enable')">启用</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog.open" :title="dialog.mode === 'bind' ? '绑定设备' : '编辑设备'" width="440px">
      <el-form ref="formRef" :model="dialog.form" :rules="rules" label-width="80px" @submit.prevent="submit">
        <el-form-item v-if="dialog.mode === 'bind'" label="设备码" prop="code">
          <el-input v-model.trim="dialog.form.code" maxlength="8" placeholder="屏幕上显示的 8 位码" style="text-transform: uppercase" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model.trim="dialog.form.name" maxlength="40" placeholder="如：万达 1F 中庭 1 号机" />
        </el-form-item>
        <el-form-item label="摆放地点" prop="location">
          <el-input v-model.trim="dialog.form.location" maxlength="60" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.open = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" @click="submit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { STATUS_TAG, STATUS_TEXT, fmtTime } from '../../store.js';

const items = ref([]);
const loading = ref(false);
const formRef = ref();
const dialog = reactive({ open: false, mode: 'bind', id: null, saving: false, form: { code: '', name: '', location: '' } });

const rules = {
  code: [{ required: true, pattern: /^[A-Za-z0-9]{8}$/, message: '设备码为 8 位字母或数字', trigger: 'blur' }],
  name: [{ required: true, message: '请填写名称', trigger: 'blur' }],
};

async function load() {
  loading.value = true;
  try {
    items.value = (await api('admin/devices')).items;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function openBind(row) {
  Object.assign(dialog, { open: true, mode: 'bind', id: null, form: { code: row?.code ?? '', name: '', location: '' } });
}

function openEdit(row) {
  Object.assign(dialog, { open: true, mode: 'edit', id: row.id, form: { code: row.code, name: row.name, location: row.location } });
}

async function submit() {
  if (!(await formRef.value.validate().catch(() => false))) return;
  dialog.saving = true;
  try {
    const { code, name, location } = dialog.form;
    if (dialog.mode === 'bind') {
      await api('admin/devices/bind', { method: 'POST', body: { code: code.toUpperCase(), name, location } });
    } else {
      await api(`admin/devices/${dialog.id}`, { method: 'PATCH', body: { name, location } });
    }
    ElMessage.success('已保存');
    dialog.open = false;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    dialog.saving = false;
  }
}

async function toggle(row, action) {
  if (action === 'disable') {
    const ok = await ElMessageBox.confirm('停用后该设备立即不能试穿。', '停用设备', { type: 'warning' }).catch(() => false);
    if (!ok) return;
  }
  try {
    await api(`admin/devices/${row.id}/${action}`, { method: 'POST' });
    ElMessage.success(action === 'disable' ? '已停用' : '已启用');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  }
}

onMounted(load);
</script>
