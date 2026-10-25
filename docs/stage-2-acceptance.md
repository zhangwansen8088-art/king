# 第二阶段隔离验收记录

## 验收范围

- 验收日期：2026-10-25（北京时间）。
- 代码基线：`codex/engineering-baseline` 分支，起始提交 `270e4aa`。
- 运行环境：Node.js `v24.19.0`、pnpm `11.25.0`、PostgreSQL `17.11`。
- 数据库：本机 Docker 隔离容器 `max-promotion-integration-test-270e4aa`，仅监听 `127.0.0.1:55432`。
- 测试库：`max_promotion_test`、`max_promotion_restore_test`、`max_promotion_seed_test`。
- 数据性质：自动测试数据，不是生产数据、真实商户资料或真实资金。

## 已通过项目

| 验收项                         | 实际结果                                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| 全新 PostgreSQL 迁移           | 通过                                                               |
| 演示种子                       | 3 个账号、3 个 Argon2id 密码哈希、3 个钱包、1 个商户、1 条审计日志 |
| PostgreSQL 业务闭环            | 17/17 项通过                                                       |
| 同一推广客户并发领取           | 仅 1 条提交、1 笔保证金冻结流水                                    |
| 多客户竞争单名额任务           | 名额未超卖，任务领取数保持为 1                                     |
| 商户广告余额不足               | 发布被拒绝，任务、资金流水和发布审计均未落库                       |
| 同一提现并发打款               | 仅 1 次成功扣款和 1 条打款审计                                     |
| 同一 `requestId` 并发发布      | 稳定返回同一任务，仅 1 条预算冻结流水                              |
| 格式、类型、单元测试、生产构建 | `pnpm check` 和 `pnpm format:check` 通过                           |
| 备份、恢复与逐表核对           | 10 张表的数据指纹完全一致，演练耗时 1 秒                           |

本轮备份文件 SHA-256：

```text
c255e209a60a5e01306c2de92968476d9f3a8d281cccb4d6ce89994177ecbd11
```

## 复验命令

```bash
TEST_DATABASE_URL='postgresql://max_promotion:integration-only-password@127.0.0.1:55432/max_promotion_test?schema=public' \
pnpm test:integration

POSTGRES_CONTAINER=max-promotion-integration-test-270e4aa \
POSTGRES_USER=max_promotion \
POSTGRES_PASSWORD=integration-only-password \
SOURCE_DB=max_promotion_test \
TARGET_DB=max_promotion_restore_test \
pnpm test:backup-restore

pnpm check
pnpm format:check
```

## 尚未完成

- 旧 SQLite 数据尚未迁移；数据源、演示资金、二三级返佣、充值单和取消提现状态仍待业务对方书面确认。
- 备份恢复只在同一 PostgreSQL 实例内完成。独立服务器、加密备份、异地副本、WAL（预写日志）归档和实际恢复耗时尚未验证。
- 尚未连接 GitHub 远程仓库，尚未由真实 GitHub Actions 执行持续集成（CI）。
- 尚未进行真实资金切换、认证权限调整或生产部署。

## 风险与回滚

- 本轮改动仅涉及自动化测试和验收文档，不修改数据库结构、认证权限、旧 SQLite 或业务数据。
- 若本轮提交后需要回滚，执行 `git revert <本轮提交哈希>`；无需执行数据库回滚。
- 验收完成后可停止临时容器：

```bash
docker stop max-promotion-integration-test-270e4aa
```

该容器以 `--rm` 启动，停止后自动删除，不影响任何本地正式数据库。
