import { createHash, createHmac, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

/**
 * Xmax 服务端调用。永久密钥只在这里用，不下发设备。
 * 上传流程与官方 SDK 一致：GET /cos/sts 拿腾讯云 COS 临时凭证 → PUT 到 prefix 下 → 得到公网 URL。
 */

async function xmaxRequest(ctx, method, path, body) {
  const { apiKey, apiBase } = ctx.config.xmax;
  if (!apiKey || !apiBase) throw new HttpError(503, 'XMAX_NOT_CONFIGURED', '服务端未配置 Xmax 密钥');
  let res;
  let payload = null;
  try {
    res = await ctx.fetchImpl(`${apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Api-Key': apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    payload = JSON.parse(await res.text());
  } catch {
    throw new HttpError(502, 'XMAX_UPSTREAM_ERROR', '试穿服务暂时不可用');
  }
  const data = payload?.data ?? null;
  if (!res.ok || !data) throw new HttpError(502, 'XMAX_UPSTREAM_ERROR', '试穿服务暂时不可用');
  return data;
}

/** 临时密钥（设备试穿用） */
export async function issueTemporaryKey(ctx) {
  const { keyExpireSeconds, keyPointsLimit } = ctx.config.xmax;
  const data = await xmaxRequest(ctx, 'POST', '/temporary-api-key', {
    expireSeconds: keyExpireSeconds,
    pointsLimit: keyPointsLimit,
  });
  if (!data.temporaryApiKey) throw new HttpError(502, 'XMAX_UPSTREAM_ERROR', '试穿服务暂时不可用');
  return {
    temporaryApiKey: data.temporaryApiKey,
    expireTimestamp: data.expireTimestamp ?? null,
    pointsLimit: data.pointsLimit ?? keyPointsLimit,
  };
}

// 腾讯云 COS 要求的编码：在 encodeURIComponent 基础上再编码 !'()*
function cosEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const hmacSha1 = (key, s) => createHmac('sha1', key).update(s).digest('hex');

/** COS v5 请求签名（q-sign-algorithm=sha1），只签 host 头 */
export function cosAuthorization({ secretId, secretKey, method, pathname, headers, nowSec, ttlSec = 600 }) {
  const keyTime = `${nowSec - 60};${nowSec + ttlSec}`;
  const entries = Object.entries(headers)
    .map(([k, v]) => [cosEncode(k.toLowerCase()), cosEncode(String(v))])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const headerList = entries.map(([k]) => k).join(';');
  const headerString = entries.map(([k, v]) => `${k}=${v}`).join('&');
  const httpString = `${method.toLowerCase()}\n${pathname}\n\n${headerString}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
  const signature = hmacSha1(hmacSha1(secretKey, keyTime), stringToSign);
  return [
    'q-sign-algorithm=sha1',
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    'q-url-param-list=',
    `q-signature=${signature}`,
  ].join('&');
}

const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** 上传服饰图到 Xmax 的 COS，返回公网 URL。文件名由服务端生成，只含 ASCII */
export async function uploadImage(ctx, buffer, contentType) {
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) throw new HttpError(400, 'UNSUPPORTED_MEDIA', '只支持 JPG、PNG、WebP 图片');
  const sts = await xmaxRequest(ctx, 'GET', '/cos/sts');
  const cred = sts.credentials ?? {};
  if (!cred.accessKeyId || !cred.secretAccessKey || !sts.bucket || !sts.region || !sts.prefix) {
    throw new HttpError(502, 'XMAX_UPSTREAM_ERROR', '试穿服务暂时不可用');
  }

  const key = `${sts.prefix}${ctx.now()}_${randomBytes(6).toString('hex')}.${ext}`;
  const host = `${sts.bucket}.cos.${sts.region}.myqcloud.com`;
  const pathname = `/${key}`;
  const authorization = cosAuthorization({
    secretId: cred.accessKeyId,
    secretKey: cred.secretAccessKey,
    method: 'PUT',
    pathname,
    headers: { host },
    nowSec: Math.floor(ctx.now() / 1000),
  });

  let res;
  try {
    res = await ctx.fetchImpl(`https://${host}${pathname}`, {
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'Content-Type': contentType,
        'x-cos-security-token': cred.sessionToken ?? '',
      },
      body: buffer,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new HttpError(502, 'XMAX_UPLOAD_FAILED', '图片上传失败，请重试');
  }
  if (!res.ok) throw new HttpError(502, 'XMAX_UPLOAD_FAILED', '图片上传失败，请重试');
  return `https://${host}${pathname}`;
}
