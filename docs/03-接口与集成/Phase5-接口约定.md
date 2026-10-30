# Phase 5 接口约定（试穿快照、核销短码）

> 文档用途：Phase 5 服务端、后台、设备前台三方共用的接口口径
> 当前状态：开发中
> 最后更新时间：2026-10-31
> 对应需求：RDM-01~05

## 1. 数据口径

- 快照 `snapshot`：`token`（随机 ≥128 bit，base64url）、`code`（6 位数字，未核销且未过期的快照里唯一）、`garment_id`、`merchant_id`（取服饰所属商家，生成时固定）、`device_id`、`image_key`（可空，上传前为空）、`expires_at = created_at + 7 天`、`redeemed_at`、`redeemed_by`、`purged_at`。
- 流程分两步：设备先“预约”拿到短码和链接，Canvas 合成（画面 + 店铺名、商品名、短码、折扣文字）后再上传图片。预约后 10 分钟内未上传的快照视为作废，不可核销。
- 短码一次性、7 天有效、只能由所属商家核销；重复、过期、跨商家、未上传图片一律拒绝，错误码见 §5。
- 过期清理：服务端启动后每小时执行一次 `purgeExpiredSnapshots`，删除过期图片并写 `purged_at`；快照页读取时也按过期判断，不依赖清理是否已跑。
- 公网地址：新增环境变量 `PUBLIC_BASE_URL`（如 `https://example.com/sl`），快照链接 = `PUBLIC_BASE_URL + /s/<token>`；未配置时用请求的 origin 推算（仅本地开发）。
- 隐私：快照只凭令牌访问，不记录顾客任何身份信息；页面 `noindex` 且响应头带 `X-Robots-Tag: noindex, nofollow`。

## 2. 设备接口（Bearer 设备令牌，需绑定）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/device/snapshots` | `{ garmentId }` → `{ id, code, url, qrSvg, expiresAt }`；服饰需对设备可见，否则 404；限流每台设备每分钟 10 次 |
| PUT | `/api/device/snapshots/:id/image` | multipart 字段 `image`（jpg/png/webp，≤5MB），只能上传一次，超过 10 分钟 410 |

`qrSvg` 是服务端用 `qrcode` 生成的 SVG 字符串，设备直接插入（服务端生成，不含外部引用）。

## 3. 公开页面（不在 /api 下）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/s/:token` | 服务端直出 HTML：图片 + “长按保存图片” + 店铺位置 + 短码 + 有效期；底部小字链接“商家核销”指向 `admin/#/merchant/redeem?token=<token>`。过期或作废显示“已过期”，未知令牌 404 |
| GET | `/s/:token/image` | 图片本体，过期 / 已清理 404，`Cache-Control: private, max-age=3600` |

nginx 需要把 `/sl/s/` 一并代理到服务端（Phase 8 部署时加）。

## 4. 商家接口（merchant，已审核）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/merchant/redeem/lookup` | `{ code }` 或 `{ token }` → `{ id, code, garmentTitle, imageUrl, createdAt, expiresAt, redeemedAt, state }`；`state`: `valid / redeemed / expired`；跨商家统一返回 404，不泄露是否存在 |
| POST | `/api/merchant/redeem` | `{ code }` 或 `{ token }` → 核销成功返回同上；审计 `snapshot.redeem` |
| GET | `/api/merchant/redemptions` | `page`、`pageSize` → `{ items, total }`，只看自己已核销的 |

短码查询限流：每个商家账号每分钟 20 次，防止穷举。

## 5. 错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 404 | `SNAPSHOT_NOT_FOUND` | 短码 / 令牌不存在，或不属于当前商家 |
| 409 | `SNAPSHOT_REDEEMED` | 已核销 |
| 410 | `SNAPSHOT_EXPIRED` | 已过期、作废或图片已清理 |
| 409 | `SNAPSHOT_IMAGE_EXISTS` | 重复上传图片 |

## 6. 总后台

- `GET /api/admin/snapshots`：`merchantId?`、`state?`、`page=1`、`pageSize=20(≤100)` → `{ items, total }`，只读，用于排查；不展示图片以外的顾客信息（本来也没有）。
  - 每项：`{ id, code, merchantId, brandName, garmentId, garmentTitle, deviceId, deviceName, state, hasImage, createdAt, expiresAt, redeemedAt, purgedAt }`。

## 7. 补充口径（后台已按此实现）

- 时间字段一律毫秒时间戳。
- `imageUrl`：可核销 / 已核销且未清理时为 `/s/<token>/image` 的完整路径（含部署前缀，如 `/sl/s/<token>/image`）或 `media/...` 相对路径；已清理为空字符串。
- 预约后 10 分钟未上传的作废快照，对外 `state` 一律为 `expired`，不单独区分。
- `merchant/redemptions` 每项：`{ id, code, garmentTitle, createdAt, redeemedAt }`。
- `/s/:token` 页的“商家核销”链接：`<后台地址>/#/merchant/redeem?token=<token>`（后台是 hash 路由，`#/` 不能省）。未登录时后台会先跳登录页，登录后带 `redirect` 回到核销页。
- 被限流时 429，`message` 用中文提示，后台直接展示。
