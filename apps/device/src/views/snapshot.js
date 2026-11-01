import { errorMessage, request } from '../api.js';
import { button, h, toast } from '../dom.js';
import { bindTap } from '../tap.js';
import { trackEvent } from '../events.js';
import { glassModal } from '../glass.js';

/**
 * 试穿中“扫码领优惠”（RDM-01，接口见 docs/03-接口与集成/Phase5-接口约定.md §2）：
 *   点按钮 → 确认层“扫码将保存您的试穿照片” → 确认后立即截取远端换装画面当前帧
 *   → POST /api/device/snapshots 预约短码 → Canvas 合成（画面 + 店铺/品牌、商品名、短码、折扣）
 *   → PUT /api/device/snapshots/:id/image 上传 JPEG → 显示二维码层，30 秒自动关闭。
 * 只截取 SDK 已渲染的换装结果画面，不做人脸检测、不采集任何身份信息。
 * 全程不碰试穿会话，显示期间试穿和计费照常进行；失败只提示，不自动重试（避免刷接口）。
 */
const QR_SECONDS = 30;
const MAX_EDGE = 1600; // 合成图长边上限
const BAR_RATIO = 0.3; // 底部信息条高度 / 图宽
const MAX_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITIES = [0.85, 0.7, 0.55];
const FONT = "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";

class SnapError extends Error {}

/**
 * 截取远端画面当前帧，按屏幕上的显示区域（cover 裁切）裁成和顾客看到的一致。
 * SDK（火山 RTC）把远端流渲染成 remote 容器里的 <video>（srcObject 为 MediaStream，一般不受跨域污染）；
 * 兼容将来改成 <canvas> 渲染。若画面被污染，getImageData 会抛 SecurityError，这里提前探测。
 */
function captureFrame(remote) {
  const source = remote.querySelector('video') || remote.querySelector('canvas');
  const isVideo = source instanceof HTMLVideoElement;
  const sw = isVideo ? source.videoWidth : source?.width;
  const sh = isVideo ? source.videoHeight : source?.height;
  if (!source || !sw || !sh || (isVideo && source.readyState < 2)) {
    throw new SnapError('画面还没准备好，请稍候再试');
  }
  // 按容器宽高比做 cover 裁切
  const box = remote.getBoundingClientRect();
  let cx = 0;
  let cy = 0;
  let cw = sw;
  let ch = sh;
  if (box.width > 0 && box.height > 0) {
    const target = box.width / box.height;
    if (sw / sh > target) {
      cw = Math.round(sh * target);
      cx = Math.round((sw - cw) / 2);
    } else {
      ch = Math.round(sw / target);
      cy = Math.round((sh - ch) / 2);
    }
  }
  // 合成后长边（含信息条）不超过 MAX_EDGE
  const scale = Math.min(1, MAX_EDGE / Math.max(cw, ch + cw * BAR_RATIO));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(cw * scale));
  canvas.height = Math.max(1, Math.floor(ch * scale));
  const ctx = canvas.getContext('2d');
  try {
    ctx.drawImage(source, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
    ctx.getImageData(0, 0, 1, 1); // 受污染时抛 SecurityError
  } catch (error) {
    console.error('[snapshot] 截帧失败', error);
    throw new SnapError('截图失败，请重试');
  }
  return canvas;
}

/** 超出宽度时截断加省略号 */
function fitText(ctx, text, maxWidth) {
  const s = String(text || '');
  if (ctx.measureText(s).width <= maxWidth) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${s.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
}

/** 画面 + 底部信息条（店铺名/品牌、商品名、折扣文字、核销短码） */
function compose(frame, garment, code) {
  const width = frame.width;
  const barH = Math.round(width * BAR_RATIO);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = frame.height + barH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(frame, 0, 0);

  const u = width / 100;
  const top = frame.height;
  ctx.fillStyle = '#0b0b16';
  ctx.fillRect(0, top, width, barH);
  const accent = ctx.createLinearGradient(0, 0, width, 0);
  accent.addColorStop(0, '#ff4fd8');
  accent.addColorStop(1, '#6c8cff');
  ctx.fillStyle = accent;
  ctx.fillRect(0, top, width, Math.max(2, Math.round(0.6 * u)));

  const left = 5 * u;
  const leftMax = 56 * u;
  const right = width - 5 * u;
  ctx.textBaseline = 'alphabetic';

  // 左栏：品牌 · 店铺位置 / 商品名 / 折扣 / 有效期提示
  const shop = [garment.brandName, garment.shopLocation].filter(Boolean).join(' · ');
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${4.4 * u}px ${FONT}`;
  ctx.fillText(fitText(ctx, shop || '—', leftMax), left, top + 9 * u);
  ctx.fillStyle = '#dfe3f0';
  ctx.font = `400 ${3.6 * u}px ${FONT}`;
  ctx.fillText(fitText(ctx, garment.title, leftMax), left, top + 15 * u);
  if (garment.discountText) {
    ctx.fillStyle = '#ffb3c6';
    ctx.fillText(fitText(ctx, garment.discountText, leftMax), left, top + 21 * u);
  }
  ctx.fillStyle = '#a3a7b8';
  ctx.font = `400 ${2.8 * u}px ${FONT}`;
  ctx.fillText('7 天内到店出示核销码', left, top + 26.5 * u);

  // 右栏：核销短码
  ctx.textAlign = 'right';
  ctx.fillStyle = '#a3a7b8';
  ctx.font = `400 ${2.8 * u}px ${FONT}`;
  ctx.fillText('核销码', right, top + 11 * u);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${7.5 * u}px ${FONT}`;
  ctx.fillText(fitText(ctx, code, 36 * u), right, top + 21 * u);
  return canvas;
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob 返回空'))), 'image/jpeg', quality);
    } catch (error) {
      reject(error); // 画布受污染时同步抛 SecurityError
    }
  });
}

async function encode(canvas) {
  try {
    for (const q of JPEG_QUALITIES) {
      const blob = await toJpeg(canvas, q);
      if (blob.size <= MAX_BYTES) return blob;
    }
  } catch (error) {
    console.error('[snapshot] 导出图片失败', error);
    throw new SnapError('截图失败，请重试');
  }
  throw new SnapError('照片过大，请重试');
}

function reserveMessage(status, data) {
  if (status === 404) return '该服饰已下架，暂不能领取优惠';
  if (status === 410) return '优惠已失效，请重新领取';
  if (status === 429) return errorMessage(data, '操作太频繁，请稍后再试');
  return errorMessage(data, `领取失败（${status}），请稍后再试`);
}

function uploadMessage(status, data) {
  if (status === 404) return '本次领取已失效，请重新点击领取';
  if (status === 410) return '本次领取已超时，请重新点击领取';
  if (status === 413) return '照片过大，请重试';
  if (status === 429) return errorMessage(data, '操作太频繁，请稍后再试');
  return errorMessage(data, `照片上传失败（${status}），请稍后再试`);
}

/** 服务端生成的 SVG 走 <img> data URL 显示：放在专用容器里，SVG 内即使有脚本也不会执行 */
function qrImage(svg) {
  const text = String(svg || '').trim();
  if (!/^(<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(text)) return null;
  return h('img', {
    class: 'snap-qr-img',
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`,
    alt: '试穿照片二维码',
    draggable: 'false',
  });
}

/**
 * onScreenGarment()：当前已上屏的服饰（未上屏 / 换装中 / 断线时返回 null）。
 * 返回 { button, layers, sync, dispose }：button 放进角标，layers 放进试穿根节点，
 * 试穿页阶段变化时调 sync()，离开试穿页时调 dispose()。
 */
export function createSnapshotFlow({ remote, onScreenGarment }) {
  let busy = false;
  let disposed = false;
  let qrTimer = null;

  const btn = h('button', { type: 'button', class: 'badge-qr', 'aria-label': '扫码领优惠' }, '扫码领优惠');

  // 确认层（玻璃弹层；右上角关闭等同取消）
  const confirmModal = glassModal({
    title: '扫码将保存您的试穿照片',
    class: 'snap-layer',
    onClose: () => closeConfirm(),
    children: [
      h('p', { class: 'snap-tip' }, '只保存当前试穿画面，用于领取到店优惠'),
      h(
        'div',
        { class: 'snap-actions' },
        button('取消', () => closeConfirm(), 'btn btn-ghost'),
        button('确认', () => void run(), 'btn btn-primary'),
      ),
    ],
  });
  const confirmLayer = confirmModal.el;

  // 二维码层：二维码本身保持纯白不透明底（.snap-qr），方便扫码
  const qrBox = h('div', { class: 'snap-qr' });
  const qrCode = h('p', { class: 'snap-code' });
  const qrCount = h('p', { class: 'snap-count' });
  const qrModal = glassModal({
    title: '微信扫码保存试穿照片',
    class: 'snap-layer',
    onClose: () => closeQr(),
    children: [
      qrBox,
      h('p', { class: 'snap-tip' }, '核销码'),
      qrCode,
      h('p', { class: 'snap-tip' }, '7 天内到店出示核销'),
      h('div', { class: 'snap-actions' }, button('关闭', () => closeQr(), 'btn btn-ghost')),
      qrCount,
    ],
  });
  const qrLayer = qrModal.el;

  function sync() {
    btn.disabled = disposed || busy || !onScreenGarment();
    btn.textContent = busy ? '生成中…' : '扫码领优惠';
  }

  function setBusy(next) {
    busy = next;
    sync();
  }

  function closeConfirm() {
    confirmModal.close();
    setBusy(false);
  }

  function closeQr() {
    clearInterval(qrTimer);
    qrTimer = null;
    qrModal.close();
    qrBox.replaceChildren();
  }

  function showQr(img, code) {
    closeQr();
    qrBox.replaceChildren(img);
    qrCode.textContent = code;
    let left = QR_SECONDS;
    qrCount.textContent = `${left} 秒后自动关闭`;
    qrModal.open();
    qrTimer = setInterval(() => {
      left -= 1;
      if (left > 0) qrCount.textContent = `${left} 秒后自动关闭`;
      else closeQr();
    }, 1000);
  }

  bindTap(btn, () => {
    if (busy || disposed) return;
    if (!onScreenGarment()) {
      toast('请等试穿画面出来后再领取');
      return;
    }
    setBusy(true); // 确认层打开期间也算占用，防止连点
    confirmModal.open();
  });

  async function run() {
    if (disposed || !confirmModal.isOpen()) return;
    confirmModal.close();
    const garment = onScreenGarment();
    if (!garment) {
      setBusy(false);
      toast('正在换装，请稍后再领取');
      return;
    }
    try {
      const frame = captureFrame(remote); // 确认那一刻的画面
      const { status, data } = await request('device/snapshots', { method: 'POST', body: { garmentId: garment.id } });
      if (disposed) return;
      if (status !== 200 && status !== 201) throw new SnapError(reserveMessage(status, data));
      if (!data?.id || !data?.code) throw new SnapError('领取失败，请稍后再试');
      trackEvent('snapshot_create', { snapshotId: data.id, garmentId: garment.id });
      const img = qrImage(data.qrSvg);
      if (!img) throw new SnapError('二维码生成失败，请稍后再试');

      const blob = await encode(compose(frame, garment, String(data.code)));
      if (disposed) return;
      const form = new FormData();
      form.append('image', blob, 'snapshot.jpg');
      const up = await request(`device/snapshots/${encodeURIComponent(data.id)}/image`, { method: 'PUT', form });
      if (disposed) return;
      if (up.status < 200 || up.status >= 300) throw new SnapError(uploadMessage(up.status, up.data));
      showQr(img, String(data.code));
    } catch (error) {
      if (disposed) return;
      if (error instanceof SnapError) toast(error.message);
      else {
        console.error('[snapshot]', error);
        toast(error instanceof TypeError ? '网络异常，请稍后再试' : '领取失败，请稍后再试');
      }
    } finally {
      if (!disposed) setBusy(false);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    confirmModal.close();
    closeQr();
    sync();
  }

  sync();
  return { button: btn, layers: [confirmLayer, qrLayer], sync, dispose };
}
