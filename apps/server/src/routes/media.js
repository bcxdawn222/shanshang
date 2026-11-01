import { GENDERS, SET_TYPES, loadDicts } from '../lib/garments.js';
import { HttpError } from '../lib/http.js';
import { MIME_BY_EXT } from '../lib/images.js';

const mediaParams = {
  type: 'object',
  required: ['dir', 'name'],
  properties: {
    // recharge：充值收款码；ads：广告素材；dramas：短剧专题海报；site：联系我们微信二维码、打赏码
    dir: { type: 'string', enum: ['garments', 'recharge', 'ads', 'dramas', 'site'] },
    name: { type: 'string', pattern: '^[a-f0-9]{24}\\.(jpg|png|webp|mp4|webm)$' },
  },
};

/**
 * 解析单段 Range（bytes=a-b / bytes=a- / bytes=-n）。
 * 返回 { start, end }（含 end）；格式不认识或多段返回 null（按整份返回）；不可满足返回 'unsatisfiable'
 */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/** 公开接口：媒体文件（文件名随机不可猜）、启用中的标签字典 */
export default async function mediaRoutes(app, { ctx }) {
  const { db, storage } = ctx;

  // 支持 HTTP Range：广告机 <video> 拖动、部分浏览器播放视频都依赖 206
  app.get('/media/:dir/:name', { schema: { params: mediaParams } }, async (request, reply) => {
    const key = `${request.params.dir}/${request.params.name}`;
    const size = await storage.size(key);
    if (size == null) throw new HttpError(404, 'NOT_FOUND', '文件不存在');
    reply.header('Accept-Ranges', 'bytes');
    const range = request.headers.range && size > 0 ? parseRange(request.headers.range, size) : null;
    if (range === 'unsatisfiable') {
      reply.header('Content-Range', `bytes */${size}`);
      return reply
        .code(416)
        .type('application/json; charset=utf-8')
        .send({ error: { code: 'RANGE_NOT_SATISFIABLE', message: '请求的范围无效' } });
    }
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.type(MIME_BY_EXT[key.split('.').pop()]);
    if (range) {
      reply.code(206);
      reply.header('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      reply.header('Content-Length', range.end - range.start + 1);
      return reply.send(storage.open(key, range));
    }
    reply.header('Content-Length', size);
    return reply.send(storage.open(key));
  });

  app.get('/dicts', async () => {
    const out = { category: [], scene: [], color: [], genders: GENDERS, setTypes: SET_TYPES };
    for (const item of loadDicts(db).values()) {
      if (item.enabled) out[item.kind].push({ id: item.id, name: item.name });
    }
    return out;
  });
}
