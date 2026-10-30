# Xmax 实时试穿接入

> 文档用途：Xmax 实时换装的接入方式、密钥边界与已验证结论
> 当前状态：已完成（单机试穿页已实测，2026-10-29）
> 最后更新时间：2026-10-30

## 1. 平台

使用国内站（北京星脉智动），SDK `@xmaxai/sdk`。国际站在大陆不可用。API 地址、密钥通过环境变量配置，不写入仓库。

## 2. 密钥边界

- 永久密钥 `uk-*` 只在服务端环境变量 `XMAX_API_KEY`。
- 设备调用服务端 `POST /api/device/xmax-key` 换取临时密钥 `tk-*`（有效期、积分上限由服务端设定），需设备凭证。
- 永久密钥一旦出现在聊天、日志、截图中，视为泄露，立即吊销重建。

## 3. 试穿流程（已验证）

```
取 tk- → createXmaxClient
→ connectCamera({ model: x2.0, context: { prompt, refImageUrl }, render, autoStart })
→ 换衣：session.set({ prompt, refImageUrl })，不重连
→ 结束：session.disconnect()
```

- 服饰图在服务端上架时预先上传到 Xmax 文件服务，设备直接用 URL。
- 对账：服务端可按 sessionUid 查询会话消耗积分。

## 4. 已知数据

| 项 | 值 | 证据日期 |
|---|---|---|
| 计费 | 约 40 秒 47 积分，≈70 积分/分钟 | 2026-10-29 |
| 换衣不断流 | `session.set` 后 sessionUid 不变 | 2026-10-29 |

## 5. 待验证

- 并发上限、长会话稳定性、断网重连计费规则。
