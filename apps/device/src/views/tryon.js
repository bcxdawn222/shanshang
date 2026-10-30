import { errorMessage, mediaUrl, request } from '../api.js';
import { button, h, toast } from '../dom.js';
import { bindTap } from '../tap.js';
import { createBilling } from '../segments.js';
import { getDeviceConfig } from '../config.js';
import { createSnapshotFlow } from './snapshot.js';

/**
 * 实时试穿页（复用 xmax-tryon 已验证链路）：
 *   取 tk- 临时密钥 → createXmaxClient → connectCamera({ model: x2.0, context: { prompt, refImageUrl } })
 *   → 换衣 session.set()（不重连）→ 离开 session.disconnect()
 * 计费：当前服饰真正上屏才开始计时，切换 / 结束 / 断线 / 页面隐藏时结算一段。
 * 断线只自动重连 MAX_RECONNECTS 次并退避，避免无人值守时反复建会话烧积分。
 * 不采集、不上传任何人脸或身份信息：摄像头画面只经 SDK 推给试穿服务。
 */
const MODEL = 'x2.0';
const PROMPT = '视频中人物衣服替换成参考图中衣服';
const DEFAULT_STREAM = { width: 1472, height: 832, fps: 24, maxKbps: 1200 };
const MAX_RECONNECTS = 2;
const BACKOFF_MS = [3000, 10000];
const URL_CACHE_KEY = 'shanshang.xmax-urls.v1';
const LIMIT_CONFIRM_SECONDS = 15; // 试穿到上限后“点击继续”的等待秒数

const kiosk = () => window.MagicMirrorKiosk;

function reportBusy(busy) {
  try {
    kiosk()?.setUpdateInstallIdle?.(!busy);
  } catch {
    /* 浏览器直接打开时没有壳 */
  }
}

async function streamSettings() {
  try {
    const s = await kiosk()?.getTryonSdkSettings?.();
    if (s?.width && s?.height) {
      return {
        width: Number(s.width),
        height: Number(s.height),
        fps: DEFAULT_STREAM.fps,
        maxKbps: Number(s.maxKbps) || DEFAULT_STREAM.maxKbps,
      };
    }
  } catch (error) {
    console.warn('[tryon] 读取壳清晰度设置失败', error);
  }
  return { ...DEFAULT_STREAM };
}

class TryonError extends Error {
  constructor(message, { retryable = true } = {}) {
    super(message);
    this.retryable = retryable;
  }
}

async function fetchTemporaryKey() {
  const { status, data } = await request('device/xmax-key', { method: 'POST' });
  if (status === 200 && data?.temporaryApiKey) return data.temporaryApiKey;
  // 503 未配置 / 429 频率限制 / 403 未绑定：重试没有意义
  const retryable = status >= 500 && status !== 503;
  throw new TryonError(errorMessage(data, `获取试穿密钥失败（${status}）`), { retryable });
}

function readUrlCache() {
  try {
    const v = JSON.parse(localStorage.getItem(URL_CACHE_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** 参考图：优先用服务端上架时预传的 xmaxUrl；为空时用 SDK 兜底上传本站图片，按 imagePath 缓存 */
async function ensureRefUrl(client, garment) {
  if (garment.xmaxUrl) return garment.xmaxUrl;
  const cache = readUrlCache();
  const hit = cache[garment.id];
  if (hit?.path === garment.imagePath && hit.url) return hit.url;
  const res = await fetch(mediaUrl(garment.imagePath));
  if (!res.ok) throw new TryonError(`读取服饰图片失败（${res.status}）`, { retryable: false });
  const blob = await res.blob();
  const ext = String(garment.imagePath || '').split('.').pop() || 'jpg';
  const file = new File([blob], `garment-${garment.id}.${ext}`, { type: blob.type || 'image/jpeg' });
  const result = await client.files.uploadImage(file);
  if (!result?.url) throw new TryonError('服饰图片上传失败');
  cache[garment.id] = { path: garment.imagePath, url: result.url };
  try {
    localStorage.setItem(URL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 存不下就下次再传 */
  }
  return result.url;
}

function friendlyError(error) {
  const message = String(error?.message || error || '');
  if (/permission|notallowed|denied|拒绝/i.test(message)) return '摄像头没有权限，请联系工作人员';
  if (/notfound|devicesnotfound|未找到/i.test(message)) return '没有找到摄像头，请联系工作人员';
  if (/points|credit|积分|余额/i.test(message)) return '试穿服务额度不足，请联系工作人员';
  return message || '试穿启动失败';
}

function isRetryable(error) {
  if (error instanceof TryonError) return error.retryable;
  const message = String(error?.message || error || '');
  // 摄像头、密钥、额度类问题重连也解决不了
  return !/permission|notallowed|denied|拒绝|notfound|未找到|apikey|unauthorized|401|密钥|points|credit|积分|余额/i.test(message);
}

/** items：同一列表（试穿页底部服饰条）；garmentId：初始选中 */
export function tryonEntry(items, garmentId) {
  return {
    fullscreen: true,
    render(root, nav) {
      const billing = createBilling();
      let currentId = garmentId;
      let phase = 'connecting'; // connecting | running | switching | reconnecting | failed
      let session = null;
      let client = null;
      let disposed = false;
      let reconnects = 0;
      let retryTimer = null;

      const current = () => items.find((g) => g.id === currentId) || items[0];

      const remote = h('div', { class: 'tryon-remote' });
      const local = h('div', { class: 'tryon-local' });
      const statusText = h('p', { class: 'tryon-status-text' });
      const statusActions = h('div', { class: 'tryon-status-actions' });
      const status = h('div', { class: 'tryon-status' }, statusText, statusActions);
      const badgeLocation = h('p', { class: 'badge-location' });
      const badgeDiscount = h('p', { class: 'badge-discount' });
      // 扫码领优惠：只有当前服饰真正上屏（running 且已开始计费）才可点
      const snap = createSnapshotFlow({
        remote,
        onScreenGarment: () => (phase === 'running' && billing.activeGarmentId === currentId ? current() : null),
      });
      const badge = h(
        'aside',
        { class: 'tryon-badge' },
        h('p', { class: 'badge-title' }, '店铺位置'),
        badgeLocation,
        badgeDiscount,
        snap.button,
      );
      const rail = h('div', { class: 'tryon-rail', role: 'list' });
      const endBtn = button('结束试穿', () => nav.back(), 'btn btn-danger tryon-end');

      // 试穿时长上限：从进入试穿起计时，到时弹全屏“点击继续”，倒计时内无人点则结束试穿回首页
      const enteredAt = performance.now();
      let limitTimer = null;
      let countdownTimer = null;
      const limitText = h('p', { class: 'tryon-limit-text' });
      const limitCount = h('p', { class: 'tryon-limit-count' });
      const limit = h(
        'div',
        { class: 'tryon-limit', role: 'alertdialog', 'aria-live': 'assertive', hidden: true },
        limitText,
        h('p', { class: 'tryon-limit-tip' }, '点击屏幕任意位置继续'),
        limitCount,
      );

      function armLimit() {
        clearTimeout(limitTimer);
        limitTimer = setTimeout(promptLimit, getDeviceConfig().tryonMaxMinutes * 60_000);
      }

      function promptLimit() {
        if (disposed) return;
        let left = LIMIT_CONFIRM_SECONDS;
        const minutes = Math.max(1, Math.round((performance.now() - enteredAt) / 60_000));
        limitText.textContent = `已试穿 ${minutes} 分钟，点击继续`;
        limitCount.textContent = `${left} 秒后自动结束试穿`;
        limit.hidden = false;
        clearInterval(countdownTimer);
        countdownTimer = setInterval(() => {
          left -= 1;
          if (left > 0) {
            limitCount.textContent = `${left} 秒后自动结束试穿`;
            return;
          }
          clearInterval(countdownTimer);
          countdownTimer = null;
          nav.home(); // cleanup 里断开会话并结算离屏
        }, 1000);
      }

      function continueTryon() {
        if (limit.hidden || disposed) return;
        clearInterval(countdownTimer);
        countdownTimer = null;
        limit.hidden = true;
        armLimit();
      }

      bindTap(limit, continueTryon);

      root.append(
        h('div', { class: 'tryon' }, remote, local, status, badge, endBtn, h('footer', { class: 'tryon-bar' }, rail), ...snap.layers, limit),
      );

      function setStatus(text, actions = []) {
        statusText.textContent = text;
        statusActions.replaceChildren(...actions);
        status.hidden = false;
        snap.sync();
      }

      function hideStatus() {
        status.hidden = true;
        snap.sync();
      }

      function updateBadge() {
        const g = current();
        badgeLocation.textContent = g?.shopLocation || g?.brandName || '—';
        badgeDiscount.textContent = g?.discountText || '';
        badgeDiscount.hidden = !g?.discountText;
      }

      function renderRail() {
        rail.replaceChildren(
          ...items.map((g) => {
            const item = h(
              'div',
              { class: `tryon-thumb${g.id === currentId ? ' active' : ''}`, role: 'listitem' },
              h('img', { src: mediaUrl(g.imagePath), alt: g.title || '', draggable: 'false', loading: 'lazy' }),
              h('span', {}, g.title || ''),
            );
            bindTap(item, () => void selectGarment(g.id));
            return item;
          }),
        );
        rail.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
      }

      function resetStage() {
        remote.replaceChildren();
        local.replaceChildren();
      }

      /** 会话丢失：先结算当前件，再决定是否有限次重连 */
      function dropSession() {
        billing.close();
        session = null;
        client = null;
        resetStage();
        reportBusy(false);
        snap.sync();
      }

      function retryOrFail(error) {
        if (disposed) return;
        console.error('[tryon]', error);
        if (isRetryable(error) && reconnects < MAX_RECONNECTS) {
          const delay = BACKOFF_MS[reconnects] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
          reconnects += 1;
          phase = 'reconnecting';
          setStatus(`连接中断，${Math.round(delay / 1000)} 秒后重连（${reconnects}/${MAX_RECONNECTS}）…`);
          retryTimer = setTimeout(() => void connect(), delay);
          return;
        }
        phase = 'failed';
        setStatus(friendlyError(error), [
          button(
            '重新试穿',
            () => {
              reconnects = 0;
              void connect();
            },
            'btn btn-primary',
          ),
          button('返回', () => nav.back(), 'btn btn-ghost'),
        ]);
      }

      async function connect() {
        if (disposed) return;
        phase = 'connecting';
        setStatus(reconnects ? `正在重新连接（${reconnects}/${MAX_RECONNECTS}）…` : '正在连接试穿服务，请站到镜头前…');
        try {
          const [{ createXmaxClient, models }, apiKey, stream] = await Promise.all([
            import('@xmaxai/sdk'),
            fetchTemporaryKey(),
            streamSettings(),
          ]);
          if (disposed) return;
          // 每次连接都新建 client，保证临时密钥新鲜
          const c = createXmaxClient({ apiKey, telemetry: false });
          const garment = current();
          const refImageUrl = await ensureRefUrl(c, garment);
          if (disposed) return;
          let s = null;
          const onLost = (reason) => {
            if (!s || session !== s) return; // 已主动断开或已被替换
            dropSession();
            if (reason !== 'client') retryOrFail(new Error('试穿连接已断开'));
          };
          s = await c.realtime.connectCamera({
            model: models.realtime(MODEL),
            stream,
            context: { prompt: PROMPT, refImageUrl },
            render: { remoteContainer: remote, localContainer: local, mirror: true, fit: 'cover' },
            audio: { publish: false, subscribe: false },
            autoStart: true,
            facingMode: 'user',
            onDisconnect: (reason) => onLost(reason),
            onStateChange: (next) => {
              if (next === 'disconnected') onLost('error');
            },
            onNotice: (notice) => console.info('[xmax] notice', notice?.code, notice?.message),
            onError: (message, error) => console.error('[xmax] error', error?.code, message),
          });
          if (disposed) {
            s.disconnect().catch(() => {});
            return;
          }
          client = c;
          session = s;
          phase = 'running';
          reportBusy(true);
          billing.open(garment.id);
          hideStatus();
        } catch (error) {
          if (disposed) return;
          dropSession();
          retryOrFail(error);
        }
      }

      async function selectGarment(id) {
        if (id === currentId || disposed) return;
        if (phase !== 'running') {
          toast(phase === 'switching' ? '正在换装，请稍候' : '试穿连接中，请稍候');
          return;
        }
        const target = items.find((g) => g.id === id);
        if (!target) return;
        const previousId = currentId;
        const s = session;
        phase = 'switching';
        currentId = id;
        snap.sync();
        renderRail();
        try {
          const refImageUrl = await ensureRefUrl(client, target);
          if (disposed || session !== s) return;
          await s.set({ prompt: PROMPT, refImageUrl });
          if (disposed || session !== s) return;
          billing.open(id); // 结算上一件，开始计这一件
          phase = 'running';
          updateBadge();
          snap.sync();
        } catch (error) {
          console.error('[tryon] 换装失败', error);
          if (disposed || session !== s) return;
          currentId = previousId;
          phase = 'running';
          snap.sync();
          renderRail();
          toast('换装失败，已保留上一件');
        }
      }

      // 页面隐藏（壳切后台、熄屏）即结束试穿：会话不能在没人看的时候继续计费
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') nav.back();
      };
      const onPageHide = () => teardown({ keepalive: true });
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onPageHide);

      function teardown({ keepalive = false } = {}) {
        if (disposed) return;
        disposed = true;
        snap.dispose(); // 关闭确认层 / 二维码层并清掉倒计时
        clearTimeout(retryTimer);
        clearTimeout(limitTimer);
        clearInterval(countdownTimer);
        billing.close({ keepalive });
        const s = session;
        session = null;
        client = null;
        if (s) s.disconnect().catch((error) => console.warn('[tryon] 断开异常', error));
        resetStage();
        reportBusy(false);
      }

      updateBadge();
      renderRail();
      armLimit();
      if (!current()) {
        setStatus('没有可试穿的服饰', [button('返回', () => nav.back(), 'btn btn-ghost')]);
      } else {
        void connect();
      }

      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onPageHide);
        teardown({ keepalive: document.visibilityState === 'hidden' });
      };
    },
  };
}
