import { request } from './api.js';
import { getDeviceSessionId } from './session.js';

/**
 * 埋点批量上报（docs/02-业务设计/数据统计埋点.md，接口 POST /api/device/events）。
 * 每条先写 localStorage 再上报：定时（main.js 每 10 秒）或攒满 50 条时按 sessionId 分批发送；
 * 200 移出队列，400 丢弃，其它失败保留到下次重试；服务端按 device + sessionId + seq 去重。
 * 只记业务 id 和时长，不采集任何人脸或身份信息。
 */
const QUEUE_KEY = 'shanshang.events.v1';
const SEQ_KEY = 'shanshang.events.seq.v1';
const MAX_BATCH = 50;
const MAX_QUEUE = 2000; // 长时间断网时只保留最近的，防止撑爆 localStorage
const MAX_DURATION_MS = 24 * 3600_000;
const FIELDS = ['merchantId', 'garmentId', 'garmentIds', 'snapshotId', 'durationMs', 'questionKey'];

function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[events] 写入本地存储失败', error);
  }
}

function readQueue() {
  const v = readJson(QUEUE_KEY, []);
  return Array.isArray(v) ? v : [];
}

const writeQueue = (queue) => writeJson(QUEUE_KEY, queue.slice(-MAX_QUEUE));
const keyOf = (e) => `${e.sessionId}:${e.seq}`;

function removeFromQueue(events) {
  const done = new Set(events.map(keyOf));
  writeQueue(readQueue().filter((e) => !done.has(keyOf(e))));
}

// seq 计数器和 sessionId 一起持久化：同一 sessionId 内刷新后也不会重号；换 sessionId 从 0 开始
let seqMemo = null;

function nextSeq(sessionId) {
  const stored = readJson(SEQ_KEY, null) ?? seqMemo;
  const seq = stored?.sessionId === sessionId && Number.isInteger(stored.seq) ? stored.seq : 0;
  seqMemo = { sessionId, seq: seq + 1 };
  writeJson(SEQ_KEY, seqMemo);
  return seq;
}

/** 只保留接口允许的字段，丢掉空值（多余字段服务端会 400） */
function pickFields(payload) {
  const out = {};
  for (const f of FIELDS) {
    const v = payload[f];
    if (v === undefined || v === null) continue;
    // 时长按接口上限截断（0 ~ 24 小时），超限会整批 400
    out[f] = f === 'durationMs' ? Math.min(MAX_DURATION_MS, Math.max(0, Math.round(v))) : v;
  }
  return out;
}

/**
 * 记录一条埋点。keepalive：页面卸载时立即补发一次（试穿页 pagehide 结算用）。
 */
export function trackEvent(type, payload = {}, { keepalive = false } = {}) {
  try {
    const sessionId = getDeviceSessionId();
    const event = { sessionId, seq: nextSeq(sessionId), type, ts: Date.now(), ...pickFields(payload) };
    const queue = [...readQueue(), event];
    writeQueue(queue);
    if (keepalive || queue.length >= MAX_BATCH) void flushEvents({ keepalive });
  } catch (error) {
    console.warn('[events] 记录失败', error);
  }
}

let flushing = null;

async function flushOnce(keepalive) {
  try {
    let queue = readQueue();
    while (queue.length) {
      const sessionId = queue[0].sessionId;
      const batch = queue.filter((e) => e.sessionId === sessionId).slice(0, MAX_BATCH);
      const { status, data } = await request('device/events', {
        method: 'POST',
        keepalive,
        body: { sessionId, events: batch.map(({ sessionId: _s, ...rest }) => rest) },
      });
      if (status === 200) {
        removeFromQueue(batch);
      } else if (status === 400) {
        // 数据本身不合法，重试也不会过，丢掉避免卡住整个队列
        console.warn('[events] 服务端拒收，已丢弃', data?.error?.message, batch);
        removeFromQueue(batch);
      } else {
        break; // 401/403/5xx：保留，稍后重试
      }
      queue = readQueue();
    }
  } catch (error) {
    console.warn('[events] 上报失败，稍后重试', error?.message || error);
  }
}

/** 把本地队列按 sessionId 分批上报。卸载补发（keepalive）不等正在进行的那次，重复由服务端去重 */
export function flushEvents({ keepalive = false } = {}) {
  if (keepalive) return flushOnce(true);
  if (flushing) return flushing;
  flushing = flushOnce(false).finally(() => {
    flushing = null;
  });
  return flushing;
}

/**
 * 品牌停留计时：从点品牌开始，到离开该品牌之下的所有页面为止报一次 brand_dwell。
 * 页面切换时 router 先 cleanup 旧页再同步渲染新页，所以在微任务里判断是否还留在品牌之下。
 */
export function createBrandDwell(merchantId) {
  const startedAt = performance.now();
  let depth = 0;
  let ended = false;
  return {
    enter() {
      if (!ended) depth += 1;
    },
    leave() {
      if (ended) return;
      depth -= 1;
      queueMicrotask(() => {
        if (ended || depth > 0) return;
        ended = true;
        trackEvent('brand_dwell', { merchantId, durationMs: performance.now() - startedAt });
      });
    },
  };
}
