import { Readable } from 'node:stream';
import { adminHot, assetView, dramaView, playlistRows } from '../lib/ads.js';
import { writeAudit } from '../lib/audit.js';
import { requireAccount } from '../lib/guards.js';
import { HttpError } from '../lib/http.js';
import { detectImage, detectVideo } from '../lib/images.js';

// 图片停留秒数：只对图片生效；视频播完即切，存默认值，不参与校验
export const DEFAULT_SECONDS = 8;
const MAX_PLAYLIST_ITEMS = 100;
const MAX_DRAMA_GARMENTS = 100;

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

const playlistParams = {
  type: 'object',
  required: ['deviceId'],
  properties: { deviceId: { type: 'string', pattern: '^(default|[1-9][0-9]{0,9})$' } },
};

const playlistBody = {
  type: 'object',
  required: ['items'],
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      maxItems: MAX_PLAYLIST_ITEMS,
      items: {
        type: 'object',
        required: ['assetId'],
        additionalProperties: false,
        properties: {
          assetId: { type: 'integer', minimum: 1 },
          seconds: { type: 'number' },
        },
      },
    },
  },
};

const hotParams = {
  type: 'object',
  required: ['garmentId'],
  properties: { garmentId: { type: 'integer', minimum: 1 } },
};

const hotBody = {
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  properties: { action: { type: 'string', enum: ['pin', 'unpin', 'remove', 'restore'] } },
};

const bad = (message) => new HttpError(400, 'BAD_REQUEST', message);

/** 丢弃不需要的文件分段 */
async function drain(stream) {
  // eslint-disable-next-line no-unused-vars
  for await (const _ of stream);
}

/**
 * 流式保存一个广告素材：先读文件头识别类型（不信任 Content-Type 和文件名），
 * 再边读边写存储，超过该类型上限立即中止并删掉半截文件。
 */
async function saveAssetFile(part, storage, limits) {
  const it = part.file[Symbol.asyncIterator]();
  let head = Buffer.alloc(0);
  let ended = false;
  while (head.length < 12) {
    const r = await it.next();
    if (r.done) {
      ended = true;
      break;
    }
    head = Buffer.concat([head, r.value]);
  }
  if (!head.length) throw bad('请选择素材文件');
  let type = null;
  let media = detectImage(head);
  if (media) type = 'image';
  else if ((media = detectVideo(head))) type = 'video';
  if (!type) {
    await it.return?.();
    throw new HttpError(400, 'UNSUPPORTED_MEDIA', '只支持 MP4、WebM 视频和 JPG、PNG、WebP 图片');
  }
  const max = limits[type];
  const tooLarge = () =>
    new HttpError(413, 'FILE_TOO_LARGE', type === 'video' ? '视频不能超过 200MB' : '图片不能超过 10MB');
  let size = 0;
  async function* body() {
    try {
      size += head.length;
      if (size > max) throw tooLarge();
      yield head;
      while (!ended) {
        const r = await it.next();
        if (r.done) break;
        size += r.value.length;
        if (size > max) throw tooLarge();
        yield r.value;
      }
      // busboy 到全局上限会截断文件并正常结束
      if (part.file.truncated) throw tooLarge();
    } finally {
      // 中途出错时销毁上传流，不再继续接收
      await it.return?.();
    }
  }
  const key = await storage.putStream('ads', Readable.from(body()), media.ext);
  return { key, type, size };
}

/** 读取素材上传表单：name 字段 + 名为 file 的文件（name 建议在文件前，放在后面也接受） */
async function readAssetUpload(request, storage, limits) {
  if (!request.isMultipart()) throw bad('请用表单上传');
  let name = null;
  let saved = null;
  try {
    // 全局 multipart 单文件上限是 10MB，这里按视频上限放宽，再按实际类型自行检查
    for await (const part of request.parts({ limits: { fileSize: Math.max(limits.image, limits.video) } })) {
      if (part.type !== 'file') {
        if (part.fieldname === 'name' && typeof part.value === 'string') name = part.value;
        continue;
      }
      if (part.fieldname !== 'file' || saved) {
        await drain(part.file);
        continue;
      }
      saved = await saveAssetFile(part, storage, limits);
    }
  } catch (error) {
    if (saved) await storage.remove(saved.key).catch(() => {});
    throw error;
  }
  return { name, saved };
}

/** 读取专题表单：文本字段 + 名为 poster 的图片（可选） */
async function readDramaUpload(request, maxImageBytes) {
  if (!request.isMultipart()) throw bad('请用表单上传');
  const fields = {};
  let poster = null;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const buf = await part.toBuffer();
      if (part.fieldname === 'poster' && !poster && buf.length) poster = buf;
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }
  if (poster && poster.length > maxImageBytes) throw new HttpError(413, 'FILE_TOO_LARGE', '海报不能超过 10MB');
  return { fields, poster };
}

// 总后台 Phase 4：广告素材、播放列表、热门榜干预、短剧专题（PLY-01~04、DEV-08、ADM-06）
export default async function adminAdsRoutes(app, { ctx }) {
  const { db, now, storage, uploadLimits } = ctx;
  app.addHook('preValidation', requireAccount('admin'));

  const audit = (request, action, targetType, targetId, detail) =>
    writeAudit(db, { actorId: request.account.id, action, targetType, targetId, detail, ip: request.ip, now: now() });

  // ---------- 素材 ----------

  app.get('/admin/ads/assets', async () => ({
    items: db.prepare('SELECT * FROM ad_asset ORDER BY created_at DESC, id DESC LIMIT 1000').all().map(assetView),
  }));

  app.post('/admin/ads/assets', async (request, reply) => {
    const { name: rawName, saved } = await readAssetUpload(request, storage, uploadLimits);
    if (!saved) throw bad('请选择素材文件');
    const name = (rawName ?? '').trim();
    if (!name || name.length > 60) {
      await storage.remove(saved.key).catch(() => {});
      throw bad('请填写素材名称（60 字以内）');
    }
    let id;
    try {
      id = db.transaction(() => {
        const r = db
          .prepare('INSERT INTO ad_asset (type, name, storage_key, size_bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(saved.type, name, saved.key, saved.size, request.account.id, now());
        const newId = Number(r.lastInsertRowid);
        audit(request, 'ad.upload', 'ad_asset', newId, { name, type: saved.type, sizeBytes: saved.size });
        return newId;
      })();
    } catch (error) {
      await storage.remove(saved.key).catch(() => {});
      throw error;
    }
    reply.code(201);
    return { item: assetView(db.prepare('SELECT * FROM ad_asset WHERE id = ?').get(id)) };
  });

  app.delete('/admin/ads/assets/:id', { schema: { params: idParams } }, async (request) => {
    const asset = db.prepare('SELECT * FROM ad_asset WHERE id = ?').get(request.params.id);
    if (!asset) throw new HttpError(404, 'ASSET_NOT_FOUND', '素材不存在');
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM playlist_item WHERE asset_id = ? LIMIT 1').get(asset.id)) {
        throw new HttpError(409, 'ASSET_IN_USE', '素材正在播放列表中使用，请先从播放列表移除');
      }
      db.prepare('DELETE FROM ad_asset WHERE id = ?').run(asset.id);
      audit(request, 'ad.delete', 'ad_asset', asset.id, { name: asset.name, type: asset.type });
    })();
    await storage.remove(asset.storage_key).catch(() => {});
    return { ok: true };
  });

  // ---------- 播放列表 ----------

  /** deviceId=default → null；否则必须是已存在的设备 */
  function resolveDevice(param) {
    if (param === 'default') return null;
    const id = Number(param);
    if (!db.prepare('SELECT 1 FROM device WHERE id = ?').get(id)) throw new HttpError(404, 'DEVICE_NOT_FOUND', '设备不存在');
    return id;
  }

  function playlistView(deviceId) {
    const items = playlistRows(db, deviceId).map((r) => ({ assetId: r.asset_id, seconds: r.seconds }));
    // 设备有自己的条目才算单独配置；没有时设备使用默认列表
    return { deviceId: deviceId ?? 'default', configured: deviceId === null || items.length > 0, items };
  }

  app.get('/admin/playlists/:deviceId', { schema: { params: playlistParams } }, async (request) =>
    playlistView(resolveDevice(request.params.deviceId)),
  );

  // 整体替换；设备传空列表 = 取消单独配置，回落到默认列表
  app.put('/admin/playlists/:deviceId', { schema: { params: playlistParams, body: playlistBody } }, async (request) => {
    const deviceId = resolveDevice(request.params.deviceId);
    const findAsset = db.prepare('SELECT type FROM ad_asset WHERE id = ?').pluck();
    const rows = request.body.items.map((it, i) => {
      const type = findAsset.get(it.assetId);
      if (!type) throw new HttpError(400, 'ASSET_NOT_FOUND', `第 ${i + 1} 条素材不存在`);
      if (type === 'video') return { assetId: it.assetId, seconds: DEFAULT_SECONDS };
      const seconds = it.seconds ?? DEFAULT_SECONDS;
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) throw bad(`第 ${i + 1} 条图片停留时长需为 1~120 秒`);
      return { assetId: it.assetId, seconds };
    });
    db.transaction(() => {
      db.prepare('DELETE FROM playlist_item WHERE device_id IS ?').run(deviceId);
      const insert = db.prepare('INSERT INTO playlist_item (device_id, position, asset_id, seconds) VALUES (?, ?, ?, ?)');
      rows.forEach((r, i) => insert.run(deviceId, i, r.assetId, r.seconds));
      audit(request, 'playlist.update', 'playlist', deviceId ?? 'default', { count: rows.length });
    })();
    return playlistView(deviceId);
  });

  // ---------- 热门榜 ----------

  app.get('/admin/hot', async () => ({ items: adminHot(db, now()) }));

  app.post('/admin/hot/:garmentId', { schema: { params: hotParams, body: hotBody } }, async (request) => {
    const garmentId = request.params.garmentId;
    if (!db.prepare('SELECT 1 FROM garment WHERE id = ? AND deleted_at IS NULL').get(garmentId)) {
      throw new HttpError(404, 'GARMENT_NOT_FOUND', '服饰不存在');
    }
    const { action } = request.body;
    const t = now();
    db.transaction(() => {
      const cur = db.prepare('SELECT * FROM hot_override WHERE garment_id = ?').get(garmentId) ?? { pin_order: null, removed: 0 };
      let pinOrder = cur.pin_order;
      let removed = cur.removed;
      if (action === 'pin') {
        removed = 0;
        if (pinOrder == null) {
          pinOrder = db.prepare('SELECT COALESCE(MAX(pin_order), 0) + 1 FROM hot_override').pluck().get();
        }
      } else if (action === 'unpin') {
        pinOrder = null;
      } else if (action === 'remove') {
        pinOrder = null;
        removed = 1;
      } else {
        removed = 0;
      }
      db.prepare(
        `INSERT INTO hot_override (garment_id, pin_order, removed, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (garment_id) DO UPDATE SET pin_order = excluded.pin_order, removed = excluded.removed,
                                                updated_at = excluded.updated_at`,
      ).run(garmentId, pinOrder, removed, t);
      audit(request, `hot.${action}`, 'garment', garmentId);
    })();
    return { ok: true };
  });

  // ---------- 短剧专题 ----------

  /** 校验专题字段（multipart 都是字符串）；partial=true 时未传的字段不返回 */
  function parseDramaFields(f, partial) {
    const out = {};
    if (f.title !== undefined || !partial) {
      const title = (f.title ?? '').trim();
      if (!title || title.length > 40) throw bad('请填写专题名称（40 字以内）');
      out.title = title;
    }
    if (f.garmentIds !== undefined || !partial) {
      let ids;
      try {
        ids = JSON.parse(f.garmentIds ?? '[]');
      } catch {
        throw bad('同款服饰格式不正确');
      }
      if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x) && x > 0)) throw bad('同款服饰格式不正确');
      ids = [...new Set(ids)];
      if (ids.length > MAX_DRAMA_GARMENTS) throw bad(`同款服饰最多 ${MAX_DRAMA_GARMENTS} 件`);
      const exists = db.prepare('SELECT 1 FROM garment WHERE id = ? AND deleted_at IS NULL');
      for (const id of ids) if (!exists.get(id)) throw bad(`服饰 #${id} 不存在`);
      out.garmentIds = ids;
    }
    if (f.sort !== undefined || !partial) {
      const sort = f.sort === undefined || f.sort === '' ? 0 : Number(f.sort);
      if (!Number.isInteger(sort) || sort < 0 || sort > 9999) throw bad('排序需为 0~9999 的整数');
      out.sort = sort;
    }
    if (f.enabled !== undefined || !partial) {
      const v = f.enabled ?? 'true';
      if (v !== 'true' && v !== 'false') throw bad('启用状态不正确');
      out.enabled = v === 'true';
    }
    return out;
  }

  function checkPoster(buf) {
    const image = detectImage(buf);
    if (!image) throw new HttpError(400, 'UNSUPPORTED_MEDIA', '海报只支持 JPG、PNG、WebP 图片');
    return image;
  }

  const loadDrama = (id) => {
    const d = db.prepare('SELECT * FROM drama WHERE id = ?').get(id);
    if (!d) throw new HttpError(404, 'DRAMA_NOT_FOUND', '专题不存在');
    return d;
  };

  app.get('/admin/dramas', async () => ({
    items: db.prepare('SELECT * FROM drama ORDER BY sort, id').all().map(dramaView),
  }));

  app.post('/admin/dramas', async (request, reply) => {
    const { fields, poster } = await readDramaUpload(request, uploadLimits.image);
    const input = parseDramaFields(fields, false);
    if (!poster) throw bad('请上传海报');
    const image = checkPoster(poster);
    const key = await storage.put('dramas', poster, image.ext);
    let id;
    try {
      id = db.transaction(() => {
        const t = now();
        const r = db
          .prepare(
            'INSERT INTO drama (title, poster_key, garment_ids, sort, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(input.title, key, JSON.stringify(input.garmentIds), input.sort, input.enabled ? 1 : 0, t, t);
        const newId = Number(r.lastInsertRowid);
        audit(request, 'drama.create', 'drama', newId, { title: input.title, garments: input.garmentIds.length });
        return newId;
      })();
    } catch (error) {
      await storage.remove(key).catch(() => {});
      throw error;
    }
    reply.code(201);
    return { item: dramaView(loadDrama(id)) };
  });

  app.patch('/admin/dramas/:id', { schema: { params: idParams } }, async (request) => {
    const drama = loadDrama(request.params.id);
    const { fields, poster } = await readDramaUpload(request, uploadLimits.image);
    const input = parseDramaFields(fields, true);
    const image = poster ? checkPoster(poster) : null;
    if (!image && !Object.keys(input).length) throw bad('没有要修改的内容');
    const key = image ? await storage.put('dramas', poster, image.ext) : null;
    try {
      db.transaction(() => {
        db.prepare(
          'UPDATE drama SET title = ?, poster_key = ?, garment_ids = ?, sort = ?, enabled = ?, updated_at = ? WHERE id = ?',
        ).run(
          input.title ?? drama.title,
          key ?? drama.poster_key,
          input.garmentIds ? JSON.stringify(input.garmentIds) : drama.garment_ids,
          input.sort ?? drama.sort,
          input.enabled === undefined ? drama.enabled : input.enabled ? 1 : 0,
          now(),
          drama.id,
        );
        audit(request, 'drama.update', 'drama', drama.id, { changed: [...Object.keys(input), ...(key ? ['poster'] : [])] });
      })();
    } catch (error) {
      if (key) await storage.remove(key).catch(() => {});
      throw error;
    }
    if (key) await storage.remove(drama.poster_key).catch(() => {});
    return { item: dramaView(loadDrama(drama.id)) };
  });

  app.delete('/admin/dramas/:id', { schema: { params: idParams } }, async (request) => {
    const drama = loadDrama(request.params.id);
    db.transaction(() => {
      db.prepare('DELETE FROM drama WHERE id = ?').run(drama.id);
      audit(request, 'drama.delete', 'drama', drama.id, { title: drama.title });
    })();
    await storage.remove(drama.poster_key).catch(() => {});
    return { ok: true };
  });
}
