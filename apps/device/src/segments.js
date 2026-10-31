import { request } from './api.js';

/**
 * 试穿离屏时长上报（计费）。
 * 每件服饰离屏时生成一段 { seq, garmentId, durationMs }，先写 localStorage 再上报；
 * 失败的留在队列里，下次心跳 / 下次开机重试。服务端按 device + sessionId + seq 幂等。
 */
const QUEUE_KEY = 'shanshang.segments.v1';
const MAX_SEGMENT_MS = 600_000;
const MAX_BATCH = 50;
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomSessionId(length = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

function readQueue() {
  try {
    const v = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.warn('[segments] 写入本地队列失败', error);
  }
}

const keyOf = (s) => `${s.sessionId}:${s.seq}`;

function appendQueue(segments) {
  writeQueue([...readQueue(), ...segments]);
}

function removeFromQueue(segments) {
  const done = new Set(segments.map(keyOf));
  writeQueue(readQueue().filter((s) => !done.has(keyOf(s))));
}

let flushing = null;

/** 把本地队列按 sessionId 分批上报；网络/服务端异常就停下，留到下次 */
export function flushSegments({ keepalive = false } = {}) {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      let queue = readQueue();
      while (queue.length) {
        const sessionId = queue[0].sessionId;
        const batch = queue.filter((s) => s.sessionId === sessionId).slice(0, MAX_BATCH);
        const { status, data } = await request('device/tryon/segments', {
          method: 'POST',
          keepalive,
          body: {
            sessionId,
            segments: batch.map(({ seq, garmentId, durationMs }) => ({ seq, garmentId, durationMs })),
          },
        });
        if (status === 200) {
          removeFromQueue(batch);
        } else if (status === 400) {
          // 数据本身不合法，重试也不会过，丢掉避免卡住整个队列
          console.warn('[segments] 服务端拒收，已丢弃', data?.error?.message, batch);
          removeFromQueue(batch);
        } else {
          break; // 401/403/5xx：保留，稍后重试
        }
        queue = readQueue();
      }
    } catch (error) {
      console.warn('[segments] 上报失败，稍后重试', error?.message || error);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/**
 * 一次试穿（进入试穿页到离开）的计时器。open 开始计一件，close 结束当前件并入队。
 * 计时用 performance.now()，不受系统时间调整影响。
 */
export function createBilling({ onStart, onEnd } = {}) {
  const sessionId = randomSessionId(16);
  let seq = 0;
  let current = null;

  // 埋点钩子（tryon_start / tryon_end）：与计费同一时机、同一时长，异常不影响计费
  function notify(fn, ...args) {
    try {
      fn?.(...args);
    } catch (error) {
      console.warn('[segments] 埋点回调异常', error);
    }
  }

  function close({ keepalive = false } = {}) {
    if (!current) return;
    const { garmentId, startedAt } = current;
    current = null;
    const durationMs = Math.min(MAX_SEGMENT_MS, Math.max(0, Math.round(performance.now() - startedAt)));
    notify(onEnd, { garmentId, durationMs }, { keepalive });
    if (durationMs <= 0) return;
    appendQueue([{ sessionId, seq: seq++, garmentId, durationMs }]);
    void flushSegments({ keepalive });
  }

  function open(garmentId) {
    close();
    current = { garmentId, startedAt: performance.now() };
    notify(onStart, { garmentId });
  }

  return {
    sessionId,
    open,
    close,
    get activeGarmentId() {
      return current?.garmentId ?? null;
    },
  };
}
