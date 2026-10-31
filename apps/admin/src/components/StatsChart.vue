<template>
  <!-- 按日折线图：SVG 自绘，不引入图表库（STA-03） -->
  <svg class="chart" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="ariaLabel">
    <g v-for="t in ticks" :key="t.v">
      <line :x1="L" :x2="W - R" :y1="t.y" :y2="t.y" class="grid" />
      <text :x="L - 8" :y="t.y + 4" text-anchor="end" class="axis">{{ format(t.v) }}</text>
    </g>
    <text v-for="p in xLabels" :key="p.day" :x="p.x" :y="H - 8" text-anchor="middle" class="axis">{{ p.day.slice(5) }}</text>
    <path v-if="points.length > 1" :d="areaPath" class="area" />
    <polyline v-if="points.length > 1" :points="points.map((p) => `${p.x},${p.y}`).join(' ')" class="line" />
    <template v-if="points.length <= 62">
      <circle v-for="p in points" :key="p.day" :cx="p.x" :cy="p.y" r="3.5" class="dot">
        <title>{{ p.day }}：{{ format(p.v) }}</title>
      </circle>
    </template>
  </svg>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  // [{ day: 'YYYY-MM-DD', value: number }]
  data: { type: Array, default: () => [] },
  label: { type: String, default: '' },
  // 是否整数指标（次数）；时长类为 false
  integer: { type: Boolean, default: true },
  format: { type: Function, default: (v) => String(v) },
});

const W = 800;
const H = 260;
const L = 72;
const R = 16;
const T = 16;
const B = 32;
const SEGMENTS = 5;

/** 向上取“好看”的刻度上限：1、2、5 × 10^n */
function niceCeil(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const f of [1, 2, 5, 10]) if (f * p >= v) return f * p;
  return 10 * p;
}

const yMax = computed(() => {
  const max = Math.max(0, ...props.data.map((d) => d.value || 0));
  const nice = niceCeil(max);
  return props.integer ? Math.max(SEGMENTS, nice) : nice;
});

const y = (v) => T + (H - T - B) * (1 - v / yMax.value);

const ticks = computed(() =>
  Array.from({ length: SEGMENTS + 1 }, (_, i) => {
    const v = (yMax.value / SEGMENTS) * i;
    return { v, y: y(v) };
  }),
);

const points = computed(() => {
  const n = props.data.length;
  const inner = W - L - R;
  return props.data.map((d, i) => ({
    day: d.day,
    v: d.value || 0,
    x: L + (n === 1 ? inner / 2 : (i * inner) / (n - 1)),
    y: y(d.value || 0),
  }));
});

const areaPath = computed(() => {
  const p = points.value;
  const base = y(0);
  return `M${p[0].x},${base} ${p.map((q) => `L${q.x},${q.y}`).join(' ')} L${p.at(-1).x},${base} Z`;
});

// x 轴最多约 8 个日期标签
const xLabels = computed(() => {
  const step = Math.max(1, Math.ceil(points.value.length / 8));
  return points.value.filter((_, i) => i % step === 0);
});

const ariaLabel = computed(() => {
  const total = props.data.reduce((s, d) => s + (d.value || 0), 0);
  return `${props.label}按日折线图，共 ${props.data.length} 天，合计 ${props.format(total)}`;
});
</script>

<style scoped>
.chart {
  display: block;
  width: 100%;
  height: auto;
}
.grid {
  stroke: var(--el-border-color-lighter);
  stroke-width: 1;
}
.axis {
  fill: var(--el-text-color-secondary);
  font-size: 12px;
}
.line {
  fill: none;
  stroke: var(--el-color-primary);
  stroke-width: 2;
  stroke-linejoin: round;
}
.area {
  fill: var(--el-color-primary);
  opacity: 0.08;
}
.dot {
  fill: var(--el-bg-color);
  stroke: var(--el-color-primary);
  stroke-width: 2;
}
</style>
