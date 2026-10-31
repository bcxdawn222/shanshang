import { ZODIACS, matchWheel, pickWheelIndex, seededRng } from '@shanshang/shared';
import { button, h } from '../dom.js';
import { colorHex, loadFunConfig, todayStr } from '../fun.js';
import { loadGarments } from '../garments.js';
import { getDeviceSessionId } from '../session.js';
import { playTick, unlockAudio } from '../tick.js';
import { TAU, angleAt, indexAt, planSpin, velocityAt } from '../wheel.js';
import { garmentGrid } from './browse.js';
import { GENDER_OPTIONS, SHORT_TEXT, genderLabel, isShort, pickGrid, runAsync } from './funKit.js';
import { pageShell } from './layout.js';

/**
 * 星座轮盘（FUN-01~03）：选星座 → 选男/女/童 → Canvas 转盘。
 * 结果启动前由 seededRng(日期, 星座, 设备会话 id, 次数) 定好；随机初速度 + 摩擦减速 + 落定缓动（wheel.js），
 * 可按按钮或手指甩动触发；每过一格指针拨片回弹并“嗒”一声。停下后用 matchWheel 推荐 3~6 件。
 */
const ICONS = {
  capricorn: '♑', aquarius: '♒', pisces: '♓', aries: '♈', taurus: '♉', gemini: '♊',
  cancer: '♋', leo: '♌', virgo: '♍', libra: '♎', scorpio: '♏', sagittarius: '♐',
};
// 白羊座在前，符合常见排列
const ORDER = [...ZODIACS.slice(3), ...ZODIACS.slice(0, 3)];
const SCENE_PALETTE = ['#ff4fd8', '#6c8cff', '#22c3a6', '#ffb547', '#b07cff', '#ff6f91'];
const FLING_MIN = 3; // rad/s，低于此视为轻拨，不触发
const SAMPLE_MS = 120;

// 每个设备会话内每个星座的转动次数（种子的“次数”）
let counts = { sessionId: null, map: new Map() };
function nextCount(key) {
  const sid = getDeviceSessionId();
  if (counts.sessionId !== sid) counts = { sessionId: sid, map: new Map() };
  const n = (counts.map.get(key) || 0) + 1;
  counts.map.set(key, n);
  return n;
}

const range = (z) => `${z.start[0]}.${z.start[1]} - ${z.end[0]}.${z.end[1]}`;

export function openZodiac(nav) {
  nav.push({
    render(root, nav2) {
      const body = pageShell(root, nav2, { title: '星座轮盘', subtitle: '第 1 步 · 选择你的星座' });
      body.append(
        pickGrid(
          ORDER.map((z) => ({ icon: ICONS[z.key], label: z.name, sub: range(z), onTap: () => pickGender(nav2, z) })),
          3,
        ),
      );
    },
  });
}

function pickGender(nav, zodiac) {
  nav.push({
    render(root, nav2) {
      const body = pageShell(root, nav2, { title: zodiac.name, subtitle: '第 2 步 · 为谁挑选？' });
      body.append(pickGrid(GENDER_OPTIONS.map((g) => ({ ...g, onTap: () => nav2.push(wheelEntry(zodiac, g.key)) })), 3));
    },
  });
}

// ───── 转盘配色：从 style.css 的 --wheel-* 读取，按 body.className 缓存，主题切换后下一帧重绘即生效 ─────
const WHEEL_FALLBACK = {
  '--wheel-base': '#1b1b2a',
  '--wheel-seg-alpha': '0.72',
  '--wheel-seg-soften': '0.12',
  '--wheel-seg-line': 'rgba(255,255,255,0.28)',
  '--wheel-gloss': 'rgba(255,255,255,0.18)',
  '--wheel-rim': 'rgba(255,255,255,0.08)',
  '--wheel-rim-stroke': 'rgba(255,255,255,0.55)',
  '--wheel-rim-edge': 'rgba(0,0,0,0.35)',
  '--wheel-peg': 'rgba(255,255,255,0.92)',
  '--wheel-peg-stroke': 'rgba(0,0,0,0.25)',
  '--wheel-text-light': '#ffffff',
  '--wheel-text-dark': '#1c1c1e',
  '--wheel-halo-light': 'rgba(255,255,255,0.6)',
  '--wheel-halo-dark': 'rgba(0,0,0,0.45)',
  '--wheel-hub-1': '#ff4fd8',
  '--wheel-hub-2': '#7b5cff',
  '--wheel-hub-3': '#6c8cff',
  '--wheel-hub-stroke': 'rgba(255,255,255,0.85)',
  '--wheel-pointer': '#0a84ff',
  '--wheel-pointer-deep': '#0071e3',
  '--wheel-pointer-stroke': '#ffffff',
  '--wheel-pointer-cap': '#ffffff',
  '--wheel-shadow': 'rgba(0,0,0,0.45)',
};
let wheelThemeCache = null;
function wheelTheme() {
  const key = document.body.className;
  if (wheelThemeCache && wheelThemeCache.key === key) return wheelThemeCache;
  const cs = getComputedStyle(document.body);
  const v = (name) => cs.getPropertyValue(name).trim() || WHEEL_FALLBACK[name];
  const num = (name) => {
    const x = parseFloat(v(name));
    return Number.isFinite(x) ? x : parseFloat(WHEEL_FALLBACK[name]);
  };
  wheelThemeCache = {
    key,
    base: hexRgb(v('--wheel-base')) || hexRgb(WHEEL_FALLBACK['--wheel-base']),
    segAlpha: Math.min(1, Math.max(0, num('--wheel-seg-alpha'))),
    soften: Math.min(1, Math.max(0, num('--wheel-seg-soften'))),
    segLine: v('--wheel-seg-line'),
    gloss: v('--wheel-gloss'),
    rim: v('--wheel-rim'),
    rimStroke: v('--wheel-rim-stroke'),
    rimEdge: v('--wheel-rim-edge'),
    peg: v('--wheel-peg'),
    pegStroke: v('--wheel-peg-stroke'),
    textLight: v('--wheel-text-light'),
    textDark: v('--wheel-text-dark'),
    haloLight: v('--wheel-halo-light'),
    haloDark: v('--wheel-halo-dark'),
    hub: [v('--wheel-hub-1'), v('--wheel-hub-2'), v('--wheel-hub-3')],
    hubStroke: v('--wheel-hub-stroke'),
    pointer: v('--wheel-pointer'),
    pointerDeep: v('--wheel-pointer-deep'),
    pointerStroke: v('--wheel-pointer-stroke'),
    pointerCap: v('--wheel-pointer-cap'),
    shadow: v('--wheel-shadow'),
  };
  return wheelThemeCache;
}

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const x = parseInt(m[1], 16);
  return [x >> 16, (x >> 8) & 255, x & 255];
}

const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
const luma = (rgb) => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;

// 扇区：原色向白色柔化后半透明叠在玻璃底上；按估算的实际显示色选文字颜色和反色描边
function softSegment(hex, t) {
  const soft = mix(hexRgb(hex) || hexRgb('#6c8cff'), [255, 255, 255], t.soften);
  const shown = mix(t.base, soft, t.segAlpha);
  const lightBg = luma(shown) > 0.6;
  return {
    fill: `rgba(${soft[0]},${soft[1]},${soft[2]},${t.segAlpha})`,
    text: lightBg ? t.textDark : t.textLight,
    halo: lightBg ? t.haloLight : t.haloDark,
  };
}

function wheelEntry(zodiac, gender) {
  // 页面状态挂在 entry 上：从试穿页返回时 render 会重跑，转盘角度和结果保持不变
  const state = { rotation: 0, result: null };
  const short = zodiac.name.replace(/座$/, '');

  function mount(body, cells, nav) {
    const n = cells.length;
    const fills = cells.map((c, i) => (c.color && colorHex(c.color)) || SCENE_PALETTE[i % SCENE_PALETTE.length]);
    const canvas = h('canvas', { class: 'wheel-canvas', role: 'img', 'aria-label': `${zodiac.name}幸运转盘，共 ${n} 格` });
    const spinBtn = button('转动轮盘', () => startSpin(9 + Math.random() * 5, 1), 'btn btn-primary wheel-spin');
    const hint = h('p', { class: 'wheel-hint' }, '点击按钮，或用手指甩动转盘');
    const resultBox = h('div', { class: 'wheel-result', 'aria-live': 'polite' });
    body.replaceChildren(h('div', { class: 'wheel-stage' }, canvas), spinBtn, hint, resultBox);

    const ctx = canvas.getContext('2d');
    let size = 0;
    let dpr = 1;
    let plan = null;
    let startAt = 0;
    let raf = 0;
    let lastFrame = 0;
    let lastIdx = indexAt(state.rotation, n);
    let flap = 0;
    let flapV = 0;
    let drag = null;
    let dragSpeed = 0;
    let dragDir = 1;
    let disposed = false;
    // 扇区配色按主题缓存，主题切换（body.className 变化）后重算
    let segCache = { key: null, list: [] };

    function draw() {
      if (!size) return;
      const r = size / 2;
      const R = r * 0.84;
      const rim = R * 0.07;
      const seg = TAU / n;
      const t = wheelTheme();
      if (segCache.key !== t.key) segCache = { key: t.key, list: fills.map((f) => softSegment(f, t)) };
      const segs = segCache.list;
      const hair = Math.max(1, R * 0.006);
      const fontPx = Math.round(R * (n > 10 ? 0.085 : 0.1));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(r, r);
      // 外圈：半透明玻璃环（只填环，不压在扇区下面，避免改变扇区显示色）
      ctx.beginPath();
      ctx.arc(0, 0, R + rim, 0, TAU);
      ctx.arc(0, 0, R, 0, TAU, true);
      ctx.fillStyle = t.rim;
      ctx.fill();
      ctx.save();
      ctx.rotate(state.rotation);
      ctx.lineJoin = 'round';
      for (let i = 0; i < n; i += 1) {
        const a0 = -Math.PI / 2 + i * seg;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, a0, a0 + seg);
        ctx.closePath();
        ctx.fillStyle = segs[i].fill;
        ctx.fill();
        ctx.strokeStyle = t.segLine;
        ctx.lineWidth = hair;
        ctx.stroke();
        // 文字沿半径方向：先描一圈反色光晕再填字，保证在半透明底上可读
        ctx.save();
        ctx.rotate(a0 + seg / 2);
        ctx.font = `700 ${fontPx}px 'PingFang SC','Microsoft YaHei',sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, fontPx * 0.2);
        ctx.strokeStyle = segs[i].halo;
        ctx.strokeText(cells[i].label, R * 0.6, 0, R * 0.56);
        ctx.fillStyle = segs[i].text;
        ctx.fillText(cells[i].label, R * 0.6, 0, R * 0.56);
        ctx.restore();
        // 格间拨钉
        ctx.beginPath();
        ctx.arc(Math.cos(a0) * (R + rim / 2), Math.sin(a0) * (R + rim / 2), rim * 0.3, 0, TAU);
        ctx.fillStyle = t.peg;
        ctx.fill();
        ctx.lineWidth = Math.max(1, rim * 0.08);
        ctx.strokeStyle = t.pegStroke;
        ctx.stroke();
      }
      ctx.restore();
      // 高光：不随转盘旋转，上半部一层由亮到透明的光泽
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.clip();
      const gloss = ctx.createLinearGradient(0, -R, 0, R * 0.15);
      gloss.addColorStop(0, t.gloss);
      gloss.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gloss;
      ctx.fillRect(-R, -R, R * 2, R * 1.15);
      ctx.restore();
      // 玻璃边：外沿上亮下暗的半透明白描边，内沿一道细线
      const edge = ctx.createLinearGradient(0, -R - rim, 0, R + rim);
      edge.addColorStop(0, t.rimStroke);
      edge.addColorStop(1, t.rimEdge);
      ctx.beginPath();
      ctx.arc(0, 0, R + rim - hair, 0, TAU);
      ctx.lineWidth = Math.max(1.5, R * 0.01);
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.lineWidth = hair;
      ctx.strokeStyle = t.rimEdge;
      ctx.stroke();
      ctx.restore();
      // 轮毂：品牌光斑渐变 + 半透明白边
      const hubR = R * 0.14;
      ctx.save();
      ctx.beginPath();
      ctx.arc(r, r, hubR, 0, TAU);
      const hub = ctx.createLinearGradient(r - hubR, r - hubR, r + hubR, r + hubR);
      hub.addColorStop(0, t.hub[0]);
      hub.addColorStop(0.55, t.hub[1]);
      hub.addColorStop(1, t.hub[2]);
      ctx.fillStyle = hub;
      ctx.shadowColor = t.shadow;
      ctx.shadowBlur = R * 0.04;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = R * 0.02;
      ctx.strokeStyle = t.hubStroke;
      ctx.stroke();
      ctx.restore();
      // 指针拨片：枢轴在顶部，绕枢轴摆动；主色渐变 + 白描边 + 轻阴影
      const pivotY = r - R - rim * 1.6;
      const len = rim * 1.6 + R * 0.12;
      const w = R * 0.07;
      ctx.save();
      ctx.translate(r, pivotY);
      ctx.rotate(flap);
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(0, len);
      ctx.closePath();
      const ptr = ctx.createLinearGradient(0, 0, 0, len);
      ptr.addColorStop(0, t.pointer);
      ptr.addColorStop(1, t.pointerDeep);
      ctx.fillStyle = ptr;
      ctx.shadowColor = t.shadow;
      ctx.shadowBlur = R * 0.03;
      ctx.shadowOffsetY = R * 0.008;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1.5, R * 0.012);
      ctx.strokeStyle = t.pointerStroke;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.9, 0, TAU);
      ctx.fillStyle = t.pointerCap;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, R * 0.012);
      ctx.strokeStyle = t.pointer;
      ctx.stroke();
      ctx.restore();
    }

    function resize() {
      const css = canvas.getBoundingClientRect().width;
      if (!css) return;
      dpr = window.devicePixelRatio || 1;
      size = css;
      canvas.width = Math.round(css * dpr);
      canvas.height = Math.round(css * dpr);
      draw();
    }

    function kick(speed, dir) {
      // 顺时针转时拨钉在顶部向右走，把指针尖推向右 → 拨片逆时针偏（负角）
      const amp = Math.min(0.6, 0.15 + speed * 0.035);
      flap = -dir * amp;
      flapV = 0;
      playTick(speed / 12);
    }

    function frame(now) {
      raf = 0;
      if (disposed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
      lastFrame = now;
      let speed = drag ? dragSpeed : 0;
      let dir = drag ? dragDir : 1;
      if (plan) {
        const t = (now - startAt) / 1000;
        state.rotation = angleAt(plan, t);
        speed = velocityAt(plan, t);
        dir = plan.dir;
        if (t >= plan.duration) {
          const done = plan;
          plan = null;
          state.rotation = ((done.to % TAU) + TAU) % TAU;
          finish(done);
        }
      }
      const idx = indexAt(state.rotation, n);
      if (idx !== lastIdx) {
        lastIdx = idx;
        kick(speed, dir);
      }
      // 欠阻尼弹簧回弹
      for (let left = dt; left > 0; left -= 0.008) {
        const h2 = Math.min(0.008, left);
        flapV += (-360 * flap - 16 * flapV) * h2;
        flap += flapV * h2;
      }
      draw();
      if (plan || drag || Math.abs(flap) > 0.002 || Math.abs(flapV) > 0.02) raf = requestAnimationFrame(frame);
      else {
        flap = 0;
        flapV = 0;
        draw();
      }
    }

    function wake() {
      if (raf || disposed) return;
      lastFrame = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function startSpin(v0, dir) {
      if (plan || disposed) return;
      unlockAudio();
      const rng = seededRng(todayStr(), zodiac.key, getDeviceSessionId(), nextCount(zodiac.key));
      const index = pickWheelIndex(rng, n);
      const frac = 0.2 + rng() * 0.6;
      plan = planSpin({ from: state.rotation, index, n, v0, dir, frac });
      state.result = null;
      state.rng = rng;
      resultBox.replaceChildren();
      spinBtn.disabled = true;
      hint.textContent = '转动中…';
      startAt = performance.now();
      wake();
    }

    async function finish(done) {
      const cell = cells[done.index];
      spinBtn.disabled = false;
      spinBtn.textContent = '再转一次';
      hint.textContent = '点击按钮，或用手指甩动转盘';
      showResult(cell, null);
      try {
        const garments = await loadGarments();
        if (disposed || plan) return;
        const items = matchWheel(garments, cell, { gender, rng: state.rng, count: 6 });
        state.result = { cell, items };
        showResult(cell, items);
      } catch (error) {
        if (disposed || plan) return;
        console.error('[zodiac]', error);
        showResult(cell, [], error instanceof TypeError ? '网络异常，暂时无法推荐服饰' : error.message);
      }
    }

    function showResult(cell, items, errorText) {
      const sub = cell.color ? `今日幸运色：${cell.color}` : `今日幸运风格：${cell.scene}`;
      let list;
      if (!items) list = h('p', { class: 'page-msg' }, '正在为你挑选服饰…');
      else if (errorText) list = h('p', { class: 'page-msg error' }, errorText);
      else if (!items.length) list = h('p', { class: 'page-msg' }, `暂无可推荐的${genderLabel(gender)}服饰`);
      else list = garmentGrid(items, nav);
      resultBox.replaceChildren(
        h('p', { class: 'wheel-result-title' }, `${short} · ${cell.label}`),
        h(
          'p',
          { class: 'wheel-result-sub' },
          items?.length ? `${sub} · ${isShort(items) ? SHORT_TEXT : `为你推荐 ${items.length} 件，点击试穿`}` : sub,
        ),
        list,
      );
      if (items?.length) resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ───── 手指甩动：拖动时转盘跟手，松手按最近 120ms 的角速度起转 ─────
    const angleOf = (e) => {
      const b = canvas.getBoundingClientRect();
      return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
    };
    function onDown(e) {
      if (plan || drag) return;
      unlockAudio();
      drag = { id: e.pointerId, last: angleOf(e), samples: [{ t: e.timeStamp, rot: state.rotation }] };
      dragSpeed = 0;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* 不支持就算了 */
      }
      wake();
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const a = angleOf(e);
      let d = a - drag.last;
      if (d > Math.PI) d -= TAU;
      else if (d < -Math.PI) d += TAU;
      drag.last = a;
      state.rotation += d;
      drag.samples.push({ t: e.timeStamp, rot: state.rotation });
      while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > SAMPLE_MS) drag.samples.shift();
      const first = drag.samples[0];
      const span = (e.timeStamp - first.t) / 1000;
      dragSpeed = span > 0 ? Math.abs(state.rotation - first.rot) / span : 0;
      if (d) dragDir = d > 0 ? 1 : -1;
      wake();
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const samples = drag.samples.filter((s) => e.timeStamp - s.t <= SAMPLE_MS);
      drag = null;
      if (samples.length < 2) return;
      const a = samples[0];
      const b = samples[samples.length - 1];
      const span = (b.t - a.t) / 1000;
      const v = span > 0 ? (b.rot - a.rot) / span : 0;
      if (Math.abs(v) >= FLING_MIN) startSpin(Math.min(22, Math.max(7, Math.abs(v))), v > 0 ? 1 : -1);
    }
    function onCancel() {
      drag = null;
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    window.addEventListener('resize', resize);
    requestAnimationFrame(resize);

    if (state.result) {
      spinBtn.textContent = '再转一次';
      showResult(state.result.cell, state.result.items);
    }

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      // 转到一半离开：直接记下终点角度，结果不展示（下次进来重新转）
      if (plan) state.rotation = ((plan.to % TAU) + TAU) % TAU;
      plan = null;
    };
  }

  return {
    render(root, nav) {
      const body = pageShell(root, nav, { title: `${zodiac.name} · 幸运轮盘`, subtitle: `${genderLabel(gender)} · 转一转，看看今天的幸运色` });
      let dispose = null;
      const stop = runAsync(body, loadFunConfig, (cfg) => {
        dispose = mount(body, cfg.zodiacWheel[zodiac.key], nav);
      });
      return () => {
        stop();
        dispose?.();
      };
    },
  };
}
