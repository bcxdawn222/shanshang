import { ZODIACS, matchWheel, pickWheelIndex, seededRng } from '@shanshang/shared';
import { button, h } from '../dom.js';
import { colorHex, loadFunConfig, todayStr } from '../fun.js';
import { loadGarments } from '../garments.js';
import { getDeviceSessionId } from '../session.js';
import { playTick, unlockAudio } from '../tick.js';
import { TAU, angleAt, indexAt, planSpin, velocityAt } from '../wheel.js';
import { garmentGrid } from './browse.js';
import { GENDER_OPTIONS, genderLabel, pickGrid, runAsync } from './funKit.js';
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

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const v = parseInt(m[1], 16);
  return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
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

    function draw() {
      if (!size) return;
      const r = size / 2;
      const R = r * 0.84;
      const rim = R * 0.07;
      const seg = TAU / n;
      const light = document.body.classList.contains('theme-white');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(r, r);
      // 外圈
      ctx.beginPath();
      ctx.arc(0, 0, R + rim, 0, TAU);
      ctx.fillStyle = light ? '#16182a' : '#2b2d45';
      ctx.fill();
      ctx.rotate(state.rotation);
      for (let i = 0; i < n; i += 1) {
        const a0 = -Math.PI / 2 + i * seg;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, a0, a0 + seg);
        ctx.closePath();
        ctx.fillStyle = fills[i];
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = Math.max(1, R * 0.006);
        ctx.stroke();
        // 文字沿半径方向
        ctx.save();
        ctx.rotate(a0 + seg / 2);
        ctx.fillStyle = luminance(fills[i]) > 0.62 ? '#1d1f30' : '#ffffff';
        ctx.font = `700 ${Math.round(R * (n > 10 ? 0.085 : 0.1))}px 'PingFang SC','Microsoft YaHei',sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cells[i].label, R * 0.6, 0, R * 0.56);
        ctx.restore();
        // 格间拨钉
        ctx.beginPath();
        ctx.arc(Math.cos(a0) * (R + rim / 2), Math.sin(a0) * (R + rim / 2), rim * 0.32, 0, TAU);
        ctx.fillStyle = '#f5d76e';
        ctx.fill();
      }
      ctx.restore();
      // 轮毂
      ctx.beginPath();
      ctx.arc(r, r, R * 0.14, 0, TAU);
      const hub = ctx.createLinearGradient(r - R * 0.14, r, r + R * 0.14, r);
      hub.addColorStop(0, '#ff4fd8');
      hub.addColorStop(1, '#6c8cff');
      ctx.fillStyle = hub;
      ctx.fill();
      ctx.lineWidth = R * 0.02;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      // 指针拨片：枢轴在顶部，绕枢轴摆动
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
      ctx.fillStyle = '#ff4fd8';
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = R * 0.03;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.9, 0, TAU);
      ctx.fillStyle = light ? '#16182a' : '#ffffff';
      ctx.fill();
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
        h('p', { class: 'wheel-result-sub' }, items?.length ? `${sub} · 为你推荐 ${items.length} 件，点击试穿` : sub),
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
