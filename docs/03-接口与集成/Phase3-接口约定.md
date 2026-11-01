# Phase 3 接口约定（积分账本、设备前台试穿、设备心跳与背景）

> 文档用途：Phase 3 服务端、后台、设备前台三方共用的接口口径
> 当前状态：开发中
> 最后更新时间：2026-10-31
> 对应需求：DEV-01~04、DEV-07、DEV-09、PT-01~06、SET-02~03、DVC-03~04、ADM-04

## 1. 数据口径

- 积分统一用“毫积分”整数存储（1 积分 = 1000），接口对外返回 `balance`（积分，保留 2 位小数的数字）和 `balanceMilli`。
- 扣费：`cost_milli = round(duration_ms * pointsPerMinute * 1000 / 60000)`，按秒累计，即时扣到该服饰所属商家，允许透支为负。
- 流水只追加：`ADMIN_ADD / ADMIN_DEDUCT / TRYON_CONSUME / REFUND`；`merchant.balance_milli` 是快照，可由流水重算。
- 隐藏阈值：商家余额 `< hideThreshold`（默认 5 积分）时，其服饰不出现在设备清单。
- 设备在线：`last_seen_at` 在 2 分钟内为在线。设备每 30 秒心跳一次。
- 设备背景：`black | white`，默认 `black`，总后台按设备设置。

## 2. 设备接口（Bearer 设备令牌）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/device/status` | 原字段 + `background` |
| POST | `/api/device/heartbeat` | 返回 `{ ok, background, serverTime }`，未绑定也可调（只更新 last_seen） |
| GET | `/api/device/config` | 需绑定。`{ platformName, logoUrl, background, tryonMaxMinutes }` |
| GET | `/api/device/garments` | 原字段不变；只返回 ready、审核期已到、商家 approved 且余额 ≥ 阈值的服饰 |
| POST | `/api/device/tryon/segments` | 需绑定。上报离屏时长，见下 |

`POST /api/device/tryon/segments` 请求：

```json
{ "sessionId": "8~64 位 [A-Za-z0-9_-]", "segments": [{ "seq": 0, "garmentId": 12, "durationMs": 45000 }] }
```

- `segments` 1~50 条；`seq` 非负整数；`durationMs` 0~600000（超出按 600000 截断前拒绝：直接 400）。
- 幂等键 `device_id + session_id + seq`，重复上报不重复扣费。
- 服饰不存在（含已删除）时该条跳过，计入 `skipped`。
- 返回 `{ accepted, duplicates, skipped }`。

## 3. 总后台接口（admin）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/points/merchants` | `{ items: [{ merchantId, username, brandName, status, balance, balanceMilli, usageMs, hidden }] }` |
| POST | `/api/admin/merchants/:id/points` | `{ type: 'add' \| 'deduct', amount: 0.01~1000000, note: 1~200 字 }` → `{ balance, balanceMilli }`，写审计 `points.add / points.deduct` |
| GET | `/api/admin/points/ledger` | 查询 `merchantId?`、`type?`、`page=1`、`pageSize=20(≤100)` → `{ items, total }` |
| GET | `/api/admin/points/config` | `{ pointsPerMinute, hideThreshold, xmaxRatio, rechargeContact, rechargeQrUrl, tryonMaxMinutes }` |
| PUT | `/api/admin/points/config` | 部分更新上述字段，写审计 `points.config` |
| POST | `/api/admin/points/recharge-qr` | multipart 图片（≤10MB，jpg/png/webp），存储后更新 `rechargeQrUrl` 为 `media/...`，返回 config |
| PATCH | `/api/admin/devices/:id` | 原字段 + `background: 'black' \| 'white'` |
| GET | `/api/admin/devices` | 每项增加 `background`、`online` |

流水项：`{ id, merchantId, brandName, type, amount, amountMilli, balanceAfter, garmentId, garmentTitle, deviceId, durationMs, note, createdAt }`。

配置校验：`pointsPerMinute` 0.01~100；`hideThreshold` 0~100000；`xmaxRatio` 字符串 ≤20（如 `1:10`，仅总后台可见）；`rechargeContact` ≤200；`tryonMaxMinutes` 1~30（Phase 4 用）。

## 4. 商家接口（merchant，已审核）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/merchant/points` | `{ balance, balanceMilli, usageMs, hideThreshold, hidden }` |
| GET | `/api/merchant/points/ledger` | `page`、`pageSize` → `{ items, total }`（只看自己的） |
| GET | `/api/merchant/recharge` | `{ contact, qrUrl }` |

商家看不到 `xmaxRatio`、Xmax 积分。
