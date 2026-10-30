<template>
  <div>
    <el-tabs v-model="tab">
      <!-- ---------- 星座轮盘 ---------- -->
      <el-tab-pane label="星座轮盘映射" name="wheel">
        <div class="page-head">
          <span class="muted">
            每个星座 {{ WHEEL_MIN }}~{{ WHEEL_MAX }} 格，每格是一种幸运色或幸运风格。
            <el-tag :type="wheelState.configured ? 'success' : 'info'" size="small">{{ wheelState.configured ? '自定义' : '使用默认值' }}</el-tag>
          </span>
          <div>
            <el-button :disabled="!wheelState.configured" :loading="busy === 'wheel-reset'" @click="reset('wheel')">恢复默认</el-button>
            <el-button type="primary" :loading="busy === 'wheel'" @click="saveWheel">保存全部星座</el-button>
          </div>
        </div>
        <el-radio-group v-model="zodiac" class="zodiacs">
          <el-radio-button v-for="z in ZODIACS" :key="z.key" :value="z.key">
            {{ z.name }}（{{ wheel[z.key]?.length ?? 0 }}）
          </el-radio-button>
        </el-radio-group>

        <el-table v-loading="loading" :data="wheel[zodiac] ?? []" border empty-text="暂无格子" style="max-width: 760px">
          <el-table-column label="#" width="50" align="center">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column label="显示名称" min-width="160">
            <template #default="{ row }">
              <el-input v-model.trim="row.label" :maxlength="LABEL_MAX" placeholder="如：热情红" aria-label="显示名称" />
            </template>
          </el-table-column>
          <el-table-column label="类型" width="140">
            <template #default="{ row }">
              <el-select v-model="row.kind" aria-label="类型" @change="row.value = ''">
                <el-option label="幸运色" value="color" />
                <el-option label="幸运风格" value="scene" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="匹配标签" min-width="160">
            <template #default="{ row }">
              <el-select v-model="row.value" filterable placeholder="选择字典标签" aria-label="匹配标签">
                <el-option v-for="n in dictNames[row.kind]" :key="n" :label="n" :value="n" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150">
            <template #default="{ $index }">
              <el-button link :disabled="$index === 0" @click="move(wheel[zodiac], $index, -1)">上移</el-button>
              <el-button link :disabled="$index === wheel[zodiac].length - 1" @click="move(wheel[zodiac], $index, 1)">下移</el-button>
              <el-button link type="danger" :disabled="wheel[zodiac].length <= WHEEL_MIN" @click="wheel[zodiac].splice($index, 1)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-button class="add" :disabled="(wheel[zodiac]?.length ?? 0) >= WHEEL_MAX" @click="wheel[zodiac].push({ label: '', kind: 'color', value: '' })">
          新增一格
        </el-button>
      </el-tab-pane>

      <!-- ---------- AI 推荐选项 ---------- -->
      <el-tab-pane label="AI 推荐选项" name="options">
        <div class="page-head">
          <span class="muted">
            顾客依次选场合、感觉；每个选项给场景 / 主色 / 品类加权，权重 0~{{ WEIGHT_MAX }}。
            <el-tag :type="optState.configured ? 'success' : 'info'" size="small">{{ optState.configured ? '自定义' : '使用默认值' }}</el-tag>
          </span>
          <div>
            <el-button :disabled="!optState.configured" :loading="busy === 'options-reset'" @click="reset('options')">恢复默认</el-button>
            <el-button type="primary" :loading="busy === 'options'" @click="saveOptions">保存</el-button>
          </div>
        </div>
        <div v-for="(gText, group) in GROUPS" :key="group" class="group">
          <div class="page-head">
            <h3>{{ gText }}（{{ options[group].length }}/{{ OPTION_MAX }}）</h3>
            <el-button :disabled="options[group].length >= OPTION_MAX" @click="editOption(group, -1)">新增{{ gText }}</el-button>
          </div>
          <el-table v-loading="loading" :data="options[group]" border empty-text="至少保留一项" style="max-width: 900px">
            <el-table-column prop="key" label="标识" width="130" />
            <el-table-column prop="label" label="名称" width="120" />
            <el-table-column label="权重" min-width="300">
              <template #default="{ row }">{{ weightText(row) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="200">
              <template #default="{ $index }">
                <el-button link :disabled="$index === 0" @click="move(options[group], $index, -1)">上移</el-button>
                <el-button link :disabled="$index === options[group].length - 1" @click="move(options[group], $index, 1)">下移</el-button>
                <el-button link type="primary" @click="editOption(group, $index)">编辑</el-button>
                <el-button link type="danger" :disabled="options[group].length <= 1" @click="options[group].splice($index, 1)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dialog.visible" :title="dialog.index < 0 ? `新增${GROUPS[dialog.group]}` : `编辑${GROUPS[dialog.group]}`" width="620px">
      <el-form label-width="80px">
        <el-form-item label="标识">
          <el-input v-model.trim="dialog.form.key" maxlength="32" placeholder="小写字母开头，字母数字下划线，如 date" />
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model.trim="dialog.form.label" :maxlength="LABEL_MAX" placeholder="如：约会局" />
        </el-form-item>
        <el-form-item v-for="(kText, field) in WEIGHT_FIELDS" :key="field" :label="kText">
          <div class="weights">
            <div v-for="(w, i) in dialog.form[field]" :key="i" class="weight-row">
              <el-select v-model="w.name" filterable :placeholder="`选择${kText}`" :aria-label="kText" style="width: 180px">
                <el-option v-for="n in dictNames[KIND_OF[field]]" :key="n" :label="n" :value="n" />
              </el-select>
              <el-input-number v-model="w.weight" :min="0" :max="WEIGHT_MAX" :step="0.5" :precision="1" aria-label="权重" />
              <el-button link type="danger" @click="dialog.form[field].splice(i, 1)">删除</el-button>
            </div>
            <el-button size="small" @click="dialog.form[field].push({ name: '', weight: 1 })">添加{{ kText }}</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" @click="confirmOption">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
// 共享默认值：未配置时在页面上展示并作为编辑起点（与设备端回落一致）
import { DEFAULT_RECOMMEND_OPTIONS, DEFAULT_ZODIAC_WHEEL, ZODIACS } from '../../../../../packages/shared/src/index.js';
import { api } from '../../api.js';

// 与服务端 lib/fun.js 的限制一致
const WHEEL_MIN = 8;
const WHEEL_MAX = 12;
const LABEL_MAX = 10;
const OPTION_MAX = 12;
const WEIGHT_MAX = 10;
const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const GROUPS = { occasions: '场合', feelings: '感觉' };
const WEIGHT_FIELDS = { scenes: '场景', colors: '主色', categories: '品类' };
const KIND_OF = { scenes: 'scene', colors: 'color', categories: 'category' };

const tab = ref('wheel');
const zodiac = ref(ZODIACS[0].key);
const loading = ref(false);
const busy = ref('');
const dicts = ref([]);
const wheel = reactive({});
const options = reactive({ occasions: [], feelings: [] });
const wheelState = reactive({ configured: false });
const optState = reactive({ configured: false });

// 含已停用标签（服务端同样接受）
const dictNames = computed(() => {
  const out = { category: [], scene: [], color: [] };
  for (const d of dicts.value) out[d.kind]?.push(d.name);
  return out;
});

const clone = (v) => JSON.parse(JSON.stringify(v));

/** 服务端形状 { label, color } / { label, scene } → 表格行 { label, kind, value } */
function setWheel(value) {
  const src = value ?? DEFAULT_ZODIAC_WHEEL;
  for (const z of ZODIACS) {
    wheel[z.key] = (src[z.key] ?? []).map((c) => (c.color !== undefined ? { label: c.label, kind: 'color', value: c.color } : { label: c.label, kind: 'scene', value: c.scene }));
  }
}

function setOptions(value) {
  const src = clone(value ?? DEFAULT_RECOMMEND_OPTIONS);
  options.occasions = src.occasions ?? [];
  options.feelings = src.feelings ?? [];
}

async function load() {
  loading.value = true;
  try {
    const [d, w, o] = await Promise.all([api('admin/dicts'), api('admin/fun/zodiac-wheel'), api('admin/fun/recommend-options')]);
    dicts.value = d.items;
    wheelState.configured = w.configured;
    setWheel(w.value);
    optState.configured = o.configured;
    setOptions(o.value);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function move(list, i, step) {
  const [x] = list.splice(i, 1);
  list.splice(i + step, 0, x);
}

/** 前端预检，给出定位到星座的提示；最终以服务端校验为准 */
function wheelPayload() {
  const out = {};
  for (const z of ZODIACS) {
    const cells = wheel[z.key];
    if (cells.length < WHEEL_MIN || cells.length > WHEEL_MAX) throw new Error(`${z.name}需要 ${WHEEL_MIN}~${WHEEL_MAX} 格`);
    const seen = new Set();
    out[z.key] = cells.map((c, i) => {
      if (!c.label) throw new Error(`${z.name}第 ${i + 1} 格：请填写名称`);
      if (seen.has(c.label)) throw new Error(`${z.name}第 ${i + 1} 格：名称「${c.label}」重复`);
      seen.add(c.label);
      if (!c.value) throw new Error(`${z.name}第 ${i + 1} 格：请选择匹配标签`);
      return { label: c.label, [c.kind]: c.value };
    });
  }
  return out;
}

async function saveWheel() {
  let body;
  try {
    body = wheelPayload();
  } catch (e) {
    return ElMessage.warning(e.message);
  }
  busy.value = 'wheel';
  try {
    const r = await api('admin/fun/zodiac-wheel', { method: 'PUT', body });
    wheelState.configured = r.configured;
    setWheel(r.value);
    ElMessage.success('已保存，设备下次拉取配置时生效');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    busy.value = '';
  }
}

async function saveOptions() {
  for (const [group, text] of Object.entries(GROUPS)) {
    if (!options[group].length) return ElMessage.warning(`${text}至少保留一项`);
  }
  busy.value = 'options';
  try {
    const r = await api('admin/fun/recommend-options', { method: 'PUT', body: clone(options) });
    optState.configured = r.configured;
    setOptions(r.value);
    ElMessage.success('已保存，设备下次拉取配置时生效');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    busy.value = '';
  }
}

async function reset(which) {
  const name = which === 'wheel' ? '星座轮盘映射' : 'AI 推荐选项';
  const ok = await ElMessageBox.confirm(`恢复「${name}」为系统默认值？当前自定义内容会被清除。`, '恢复默认', { type: 'warning' }).catch(() => false);
  if (!ok) return;
  busy.value = `${which}-reset`;
  try {
    const path = which === 'wheel' ? 'zodiac-wheel' : 'recommend-options';
    const r = await api(`admin/fun/${path}/reset`, { method: 'POST', body: {} });
    if (which === 'wheel') {
      wheelState.configured = r.configured;
      setWheel(r.value);
    } else {
      optState.configured = r.configured;
      setOptions(r.value);
    }
    ElMessage.success('已恢复默认');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    busy.value = '';
  }
}

function weightText(opt) {
  return Object.entries(WEIGHT_FIELDS)
    .map(([field, text]) => {
      const list = Object.entries(opt[field] ?? {});
      return list.length ? `${text}：${list.map(([n, w]) => `${n}×${w}`).join('、')}` : '';
    })
    .filter(Boolean)
    .join('；');
}

// ---------- 选项编辑弹窗（权重对象 ↔ 行数组） ----------
const dialog = reactive({ visible: false, group: 'occasions', index: -1, form: {} });

function editOption(group, index) {
  const src = index < 0 ? { key: '', label: '' } : options[group][index];
  const form = { key: src.key, label: src.label };
  for (const field of Object.keys(WEIGHT_FIELDS)) {
    form[field] = Object.entries(src[field] ?? {}).map(([name, weight]) => ({ name, weight }));
  }
  Object.assign(dialog, { visible: true, group, index, form });
}

function confirmOption() {
  const { group, index, form } = dialog;
  if (!KEY_RE.test(form.key)) return ElMessage.warning('标识需小写字母开头，只含小写字母、数字、下划线，32 位以内');
  if (!form.label) return ElMessage.warning('请填写名称');
  const others = options[group].filter((_, i) => i !== index);
  if (others.some((o) => o.key === form.key)) return ElMessage.warning(`标识「${form.key}」已存在`);
  if (others.some((o) => o.label === form.label)) return ElMessage.warning(`名称「${form.label}」已存在`);
  const item = { key: form.key, label: form.label };
  let count = 0;
  for (const [field, text] of Object.entries(WEIGHT_FIELDS)) {
    item[field] = {};
    for (const w of form[field]) {
      if (!w.name) return ElMessage.warning(`请为每条${text}权重选择标签`);
      if (item[field][w.name] !== undefined) return ElMessage.warning(`${text}「${w.name}」重复`);
      item[field][w.name] = w.weight ?? 0;
      count += 1;
    }
  }
  if (!count) return ElMessage.warning('至少设置一项权重');
  if (index < 0) options[group].push(item);
  else options[group].splice(index, 1, item);
  dialog.visible = false;
}

onMounted(load);
</script>

<style scoped>
.zodiacs {
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.add {
  margin-top: 12px;
}
.group {
  margin-bottom: 24px;
}
.group h3 {
  margin: 0;
  font-size: 15px;
}
.weights {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.weight-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
