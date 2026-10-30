import path from 'node:path';

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/** 从环境变量读取配置；测试时可以传入自定义 env 对象 */
export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || 'data');
  return {
    host: env.HOST || '127.0.0.1',
    port: int(env.PORT, 8300),
    dataDir,
    dbFile: env.DB_FILE || path.join(dataDir, 'shanshang.db'),
    trustProxy: env.TRUST_PROXY === '1',
    cookieSecure: env.COOKIE_SECURE === '1',
    sessionTtlMs: int(env.SESSION_TTL_HOURS, 168) * 3600_000,
    adminUsername: env.ADMIN_USERNAME || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    xmax: {
      apiKey: env.XMAX_API_KEY || '',
      apiBase: (env.XMAX_API_BASE || '').replace(/\/+$/, ''),
      keyExpireSeconds: int(env.XMAX_KEY_EXPIRE_SECONDS, 3600),
      keyPointsLimit: int(env.XMAX_KEY_POINTS_LIMIT, 200),
    },
  };
}
