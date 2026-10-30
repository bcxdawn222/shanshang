// 接口地址按构建 base 计算（不能按当前页面路径，history 路由下层级不固定）：
// 线上 /sl/admin/ → /sl/api/，开发时 / → /api/
const API_BASE = new URL('../api/', new URL(import.meta.env.BASE_URL, location.origin)).pathname;

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 统一请求：带 Cookie，服务端错误格式 { error: { code, message } } */
export async function api(path, { method = 'GET', body, query } = {}) {
  let url = API_BASE + path.replace(/^\//, '');
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...qs].length) url += `?${qs}`;
  }
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, 'NETWORK', '网络异常，请检查连接');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? `请求失败（${res.status}）`);
  }
  return data;
}
