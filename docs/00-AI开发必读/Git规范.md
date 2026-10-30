# Git规范

> 文档用途：分支模型、提交与 PR 规则
> 当前状态：已完成
> 最后更新时间：2026-10-30
> 仓库：`bcxdawn222/shanshang`（GitHub，公开）

## 一、分支模型

| 分支 | 角色 | 约束 |
| --- | --- | --- |
| `main` | 稳定版本 | 只接受来自 `dev` 的合并，不直接提交 |
| `dev` | 开发集成分支 | 所有功能的唯一汇合点，只通过 PR 合入 |
| `feature/bcxdawn222` | 个人开发分支 | 日常开发在这里，完成一个 Phase 向 `dev` 提 PR |
| `feature/<主题>`、`fix/<主题>` | 短期分支（可选） | 合入 `dev` 后删除 |

发布：`dev` 验收通过后，由项目负责人发起 `dev → main` 的 PR，并打 tag `vX.Y.Z`。

## 二、提交信息

格式：`<type>(<scope>): <中文摘要>`

- type：`feat` / `fix` / `docs` / `test` / `chore` / `refactor` / `perf` / `style` / `revert`
- scope：`server` / `admin` / `device` / `h5` / `docs` / `deploy`
- 摘要：动词开头，≤40 字，不加句号
- 行为变更必须写正文：问题 / 改动 / 测试 / 回滚
- 文档和代码分开提交

示例：

```text
feat(server): 新增服饰格位与上架延迟

改动：garment_slot 默认 18 格；上传后 available_at = 上传时间 + 45~75 分钟。
测试：npm test 全绿；手工验证格满返回 SLOT_FULL。
回滚：revert 本提交；迁移脚本可重复执行。
```

## 三、PR 规则

1. 目标分支 `dev`，标题 ≤70 字。
2. 描述包含：改动摘要、对应需求编号、测试结果、未验证事项、回滚方式。
3. 合并前自查 diff，确认没有密钥、`.env`、数据库文件、构建产物。
4. 合并方式：`dev` 接受 squash 或 merge commit；`dev → main` 用 merge commit 保留批次边界。
