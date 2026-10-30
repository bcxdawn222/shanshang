// 接口地址按构建 base 计算：线上 /sl/device/ → /sl/api/，开发时 / → /api/
export const API_BASE = new URL('../api/', new URL(import.meta.env.BASE_URL, location.origin)).pathname;

const STORAGE_KEY = 'shanshang.device';

let currentToken = null;

export function setToken(token) {
  currentToken = token || null;
}

export function loadIdentity() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return v?.code && v?.token ? v : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

export function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * 统一请求。默认带当前设备令牌；有 body 时才发 JSON（Fastify 对空 JSON body 会报 400）。
 * form：传 FormData 时按 multipart 发送（Content-Type 由浏览器带 boundary 自动生成）。
 * 返回 { status, data }，网络异常时抛 TypeError，由调用方决定怎么提示。
 */
export async function request(path, { method = 'GET', body, form, token, keepalive = false } = {}) {
  const headers = {};
  const auth = token === undefined ? currentToken : token;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const init = { method, headers, keepalive };
  if (form !== undefined) {
    init.body = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(API_BASE + path.replace(/^\//, ''), init);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

export function errorMessage(data, fallback) {
  return data?.error?.message || fallback;
}

/** 服务端返回的媒体相对路径（media/garments/xxx.jpg）由 /api/media/... 提供；完整 URL 原样返回 */
export function mediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return API_BASE + String(path).replace(/^\//, '');
}
