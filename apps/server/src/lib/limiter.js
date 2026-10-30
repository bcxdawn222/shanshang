const MAX_KEYS = 10_000;

/** 连续失败计数：达到上限后锁定一段时间；成功一次即清零（ACC-01：5 次锁 15 分钟） */
export class FailureLimiter {
  constructor({ maxFailures = 5, lockMs = 15 * 60_000, now = Date.now } = {}) {
    this.maxFailures = maxFailures;
    this.lockMs = lockMs;
    this.now = now;
    this.entries = new Map();
  }

  /** 剩余锁定毫秒数，0 表示未锁定 */
  lockedFor(key) {
    const entry = this.entries.get(key);
    if (!entry?.lockedUntil) return 0;
    const left = entry.lockedUntil - this.now();
    if (left > 0) return left;
    this.entries.delete(key);
    return 0;
  }

  fail(key) {
    const t = this.now();
    let entry = this.entries.get(key);
    // 很久以前的失败不再累计
    if (!entry || t - entry.lastAt > this.lockMs) entry = { count: 0, lockedUntil: 0, lastAt: t };
    entry.count += 1;
    entry.lastAt = t;
    if (entry.count >= this.maxFailures) {
      entry.lockedUntil = t + this.lockMs;
      entry.count = 0;
    }
    this.entries.set(key, entry);
    if (this.entries.size > MAX_KEYS) this.prune();
  }

  reset(key) {
    this.entries.delete(key);
  }

  prune() {
    const t = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= t && t - entry.lastAt > this.lockMs) this.entries.delete(key);
    }
  }
}

/** 固定窗口计数：windowMs 内最多 limit 次 */
export class WindowLimiter {
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }

  /** 记一次；返回 false 表示超限 */
  hit(key) {
    const t = this.now();
    let entry = this.entries.get(key);
    if (!entry || t - entry.start >= this.windowMs) entry = { start: t, count: 0 };
    entry.count += 1;
    this.entries.set(key, entry);
    if (this.entries.size > MAX_KEYS) {
      for (const [k, e] of this.entries) if (t - e.start >= this.windowMs) this.entries.delete(k);
    }
    return entry.count <= this.limit;
  }
}
