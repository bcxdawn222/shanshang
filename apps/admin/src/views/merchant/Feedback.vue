<template>
  <div>
    <el-card shadow="never" class="block">
      <template #header>我要留言</template>
      <el-form @submit.prevent="submit">
        <el-form-item>
          <el-input v-model="content" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="问题、建议都可以写，管理员会尽快回复" aria-label="留言内容" />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="saving">提交</el-button>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="page-head" style="margin: 0">
          <span>我的留言</span>
          <el-button size="small" @click="load">刷新</el-button>
        </div>
      </template>
      <el-empty v-if="!loading && !items.length" description="暂无留言" />
      <div v-loading="loading">
        <div v-for="f in items" :key="f.id" class="item">
          <div class="meta">
            <el-tag :type="FEEDBACK_STATUS_TAG[f.status]" size="small">{{ FEEDBACK_STATUS_TEXT[f.status] }}</el-tag>
            <span class="muted">{{ fmtTime(f.createdAt) }}</span>
          </div>
          <div class="content">{{ f.content }}</div>
          <div v-if="f.status === 'replied'" class="reply">
            <div class="muted">平台回复 · {{ fmtTime(f.repliedAt) }}</div>
            <div class="content">{{ f.reply }}</div>
          </div>
        </div>
      </div>
      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        class="pager"
        background
        layout="total, prev, pager, next"
        :page-size="pageSize"
        :total="total"
        @current-change="load"
      />
    </el-card>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus';
import { onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { FEEDBACK_STATUS_TAG, FEEDBACK_STATUS_TEXT, fmtTime } from '../../store.js';

const content = ref('');
const saving = ref(false);
const items = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api('merchant/feedback', { query: { page: page.value, pageSize } });
    items.value = res.items;
    total.value = res.total;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function submit() {
  const text = content.value.trim();
  if (!text) return ElMessage.warning('请填写留言内容');
  saving.value = true;
  try {
    await api('merchant/feedback', { method: 'POST', body: { content: text } });
    ElMessage.success('已提交，管理员回复后会显示在下方');
    content.value = '';
    page.value = 1;
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.block {
  margin-bottom: 16px;
}
.item {
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.item:last-child {
  border-bottom: none;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.content {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}
.reply {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
