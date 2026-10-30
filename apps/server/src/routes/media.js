import { GENDERS, SET_TYPES, loadDicts } from '../lib/garments.js';
import { HttpError } from '../lib/http.js';
import { MIME_BY_EXT } from '../lib/images.js';

const mediaParams = {
  type: 'object',
  required: ['dir', 'name'],
  properties: {
    dir: { type: 'string', enum: ['garments'] },
    name: { type: 'string', pattern: '^[a-f0-9]{24}\\.(jpg|png|webp)$' },
  },
};

/** 公开接口：媒体文件（文件名随机不可猜）、启用中的标签字典 */
export default async function mediaRoutes(app, { ctx }) {
  const { db, storage } = ctx;

  app.get('/media/:dir/:name', { schema: { params: mediaParams } }, async (request, reply) => {
    const key = `${request.params.dir}/${request.params.name}`;
    if (!(await storage.exists(key))) throw new HttpError(404, 'NOT_FOUND', '文件不存在');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.type(MIME_BY_EXT[key.split('.').pop()]);
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
