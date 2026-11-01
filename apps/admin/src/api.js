// 接口地址按构建 base 计算（不能按当前页面路径，history 路由下层级不固定）：
// 线上 /sl/admin/ → /sl/api/，开发时 / → /api/
const API_BASE = new URL('../api/', new URL(import.meta.env.BASE_URL, location.origin)).pathname;

/**
 * 服务端返回的媒体相对路径（media/garments/xxx.jpg）转成可访问地址；
 * 已是绝对路径或完整 URL 的（如快照图片 /sl/s/<token>/image）原样返回
 */
export function mediaUrl(path) {
  if (!path) return '';
  return /^(https?:)?\/\//.test(path) || path.startsWith('/') ? path : API_BASE + path;
}

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
  if (body instanceof FormData) {
    // 文件上传：Content-Type 由浏览器带 boundary 自动生成
    init.body = body;
  } else if (body !== undefined) {
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

/**
 * 下载文件（如导出 Excel）：带 Cookie，文件名取响应头 Content-Disposition（优先 filename*），
 * 失败时按 { error: { code, message } } 抛 ApiError
 */
export async function apiDownload(path, { query, filename = 'download' } = {}) {
  let url = API_BASE + path.replace(/^\//, '');
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...qs].length) url += `?${qs}`;
  }
  let res;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', '网络异常，请检查连接');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? `请求失败（${res.status}）`);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="([^"]+)"/i.exec(cd);
  const name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : filename;
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * 带进度的上传（fetch 拿不到上传进度，这里用 XMLHttpRequest）。
 * onProgress(0~100)；signal 可中途取消。错误格式与 api() 一致。
 */
export function apiUpload(path, body, { method = 'POST', onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, API_BASE + path.replace(/^\//, ''));
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.min(Math.round((e.loaded / e.total) * 100), 100));
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // 非 JSON（如 nginx 的 413 页面）
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const fallback = xhr.status === 413 ? '文件过大，服务器拒绝接收' : `请求失败（${xhr.status}）`;
      reject(new ApiError(xhr.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? fallback));
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', '网络异常，请检查连接'));
    xhr.onabort = () => reject(new ApiError(0, 'ABORTED', '已取消上传'));
    if (signal) {
      if (signal.aborted) return xhr.abort();
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}
