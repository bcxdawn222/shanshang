# Phase 4 接口约定（播放列表、待机播放、热门榜、短剧专题、试穿时长上限）

> 文档用途：Phase 4 服务端、后台、设备前台三方共用的接口口径
> 当前状态：开发中
> 最后更新时间：2026-10-31
> 对应需求：PLY-01~04、DEV-05~06、DEV-08、ADM-06

## 1. 数据口径

- 素材：`video`（mp4/webm，≤200MB）或 `image`（jpg/png/webp，≤10MB），存我们自己的存储，路径 `media/ads/...`。
- 播放列表：总后台按设备投放；每台设备一个有序列表，条目 `{ assetId, seconds }`，`seconds` 只对图片生效（1~120，默认 8），视频播完即切。未单独配置的设备用“默认列表”（device_id 为空）。
- 空闲：任意指针事件重置；`idleMinutes`（默认 4）无操作进入播放页，若在试穿先 `disconnect` 并上报离屏。
- 试穿上限：`tryonMaxMinutes`（Phase 3 已有配置，默认 5）到时弹“点击继续”，15 秒无人点结束试穿并上报。
- 热门榜：近 7 天 `TRYON_CONSUME` 次数排序取前 20；管理员置顶（排最前，按置顶顺序）或移出（不进榜）。仍只返回设备可见服饰。
- 短剧专题：`{ title, posterKey, garmentIds[], sort, enabled }`；设备只拿启用专题及其可见服饰。

## 2. 设备接口（Bearer 设备令牌，需绑定）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/device/config` | 原字段 + `idleMinutes` |
| GET | `/api/device/playlist` | `{ version, items: [{ assetId, type, url, seconds }] }`，`version` 为内容哈希，设备据此决定是否刷新缓存 |
| GET | `/api/device/hot` | `{ items: [服饰同 /device/garments 字段 + tryonCount] }`，≤20 |
| GET | `/api/device/dramas` | `{ items: [{ id, title, posterUrl, garmentIds }] }` |

## 3. 总后台接口（admin）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/ads/assets` | `{ items: [{ id, type, name, url, sizeBytes, createdAt }] }` |
| POST | `/api/admin/ads/assets` | multipart 单文件 + `name` 字段，审计 `ad.upload` |
| DELETE | `/api/admin/ads/assets/:id` | 被播放列表引用时 409 `ASSET_IN_USE`，审计 `ad.delete` |
| GET | `/api/admin/playlists/:deviceId` | `deviceId=default` 为默认列表 → `{ deviceId, items: [{ assetId, seconds }] }` |
| PUT | `/api/admin/playlists/:deviceId` | 整体替换，≤100 条，审计 `playlist.update` |
| GET | `/api/admin/hot` | `{ items: [{ garmentId, title, brandName, tryonCount, pinned, removed }] }`（含被移出的） |
| POST | `/api/admin/hot/:garmentId` | `{ action: 'pin' \| 'unpin' \| 'remove' \| 'restore' }`，审计 `hot.<action>` |
| GET/POST | `/api/admin/dramas` | 列表 / 新建（multipart：title、garmentIds JSON、poster 图片） |
| PATCH/DELETE | `/api/admin/dramas/:id` | 修改（同字段，poster 可选）/ 删除，审计 `drama.*` |
| PUT | `/api/admin/points/config` | 增加 `idleMinutes` 1~60 |
