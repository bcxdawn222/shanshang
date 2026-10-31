import { MIME_BY_EXT } from '../lib/images.js';
import { imageAvailable, redeemUrl, snapshotStatus } from '../lib/snapshots.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** HTML 转义：页面里的所有动态内容都要过这里 */
export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// 有效期按北京时间显示
const fmtTime = (ms) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));

const STYLE = `
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f5f5;color:#222}
main{max-width:560px;margin:0 auto;padding:16px}
.card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
img{display:block;width:100%;height:auto;border-radius:8px}
.tip{text-align:center;color:#666;font-size:14px;margin:8px 0 16px}
h1{font-size:18px;margin:0 0 8px}
.row{margin:6px 0;font-size:15px}
.code{font-size:28px;font-weight:700;letter-spacing:4px;text-align:center;margin:12px 0}
.state{font-size:20px;text-align:center;padding:40px 0;color:#999}
.muted{color:#888;font-size:13px}
footer{text-align:center;margin:24px 0 8px;font-size:12px}
footer a{color:#999}
`;

function page(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

/** 公共响应头：禁止收录、禁止缓存、不外泄带令牌的 Referer、页面只加载本站图片和内联样式 */
function htmlHeaders(reply) {
  reply
    .header('X-Robots-Tag', 'noindex, nofollow')
    .header('Cache-Control', 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
    .type('text/html; charset=utf-8');
}

/**
 * 快照公开页（Phase 5 §3）：不挂 /api 前缀，nginx 把 /sl/s/ 代理到服务端 /s/。
 * 只凭令牌访问；过期、作废显示“已过期”，未知令牌 404。
 */
export default async function snapshotPageRoutes(app, { ctx }) {
  const { db, config, now, storage } = ctx;

  const load = (token) =>
    TOKEN_RE.test(token)
      ? db
          .prepare(
            `SELECT s.*, g.title AS garment_title, g.discount_text, g.shop_location AS garment_location,
                    m.brand_name, m.shop_location AS merchant_location
               FROM snapshot s
               JOIN garment g ON g.id = s.garment_id
               JOIN merchant m ON m.account_id = s.merchant_id
              WHERE s.token = ?`,
          )
          .get(token)
      : null;

  app.get('/s/:token', async (request, reply) => {
    htmlHeaders(reply);
    const row = load(request.params.token);
    if (!row) {
      return reply.code(404).send(page('链接无效', '<div class="card"><div class="state">链接无效或不存在</div></div>'));
    }
    const t = now();
    const status = snapshotStatus(row, t);
    const brand = escapeHtml(row.brand_name);
    const footer = `<footer><a href="${escapeHtml(redeemUrl(config, request, row.token))}">商家核销</a></footer>`;

    if (status === 'expired') {
      return reply.send(
        page('已过期', `<div class="card"><h1>${brand}</h1><div class="state">已过期</div><p class="muted" style="text-align:center">试穿照片和优惠已失效</p></div>`),
      );
    }
    if (status === 'pending') {
      return reply.send(
        page('照片生成中', `<div class="card"><h1>${brand}</h1><div class="state">照片生成中，请稍后刷新</div></div>${footer}`),
      );
    }

    const location = row.garment_location || row.merchant_location;
    const lines = [
      `<div class="row">商品：${escapeHtml(row.garment_title)}</div>`,
      row.discount_text ? `<div class="row">优惠：${escapeHtml(row.discount_text)}</div>` : '',
      location ? `<div class="row">店铺位置：${escapeHtml(location)}</div>` : '',
      `<div class="row muted">有效期至 ${escapeHtml(fmtTime(row.expires_at))}</div>`,
    ].join('');
    const codeBlock =
      status === 'redeemed'
        ? `<div class="code" style="color:#999">${escapeHtml(row.code)}（已核销）</div>`
        : `<div class="code">${escapeHtml(row.code)}</div><p class="tip">到店出示核销码即可享受优惠</p>`;
    // 图片用相对路径：/s/<token> 与 /sl/s/<token> 下都能解析到同目录的 image
    const img = imageAvailable(row, t)
      ? `<img src="${escapeHtml(encodeURIComponent(row.token))}/image" alt="试穿照片"><p class="tip">长按保存图片</p>`
      : '';
    return reply.send(page(`${row.brand_name} · 试穿照片`, `<div class="card">${img}<h1>${brand}</h1>${codeBlock}${lines}</div>${footer}`));
  });

  app.get('/s/:token/image', async (request, reply) => {
    const row = load(request.params.token);
    const notFound = () =>
      reply
        .code(404)
        .header('Cache-Control', 'no-store')
        .send({ error: { code: 'SNAPSHOT_NOT_FOUND', message: '图片不存在或已过期' } });
    if (!row || !imageAvailable(row, now())) return notFound();
    const size = await storage.size(row.image_key);
    if (size == null) return notFound();
    reply
      .header('Cache-Control', 'private, max-age=3600')
      .header('X-Robots-Tag', 'noindex, nofollow')
      .header('Content-Length', size)
      .type(MIME_BY_EXT[row.image_key.split('.').pop()]);
    return reply.send(storage.open(row.image_key));
  });
}
