# 备份与恢复

## 最低要求

- PostgreSQL 每日全量备份，保留至少 14 天。
- 开启 WAL（预写日志）归档，支持时间点恢复。
- 备份文件加密后复制到另一台服务器或对象存储。
- 每月至少做一次恢复演练。

## 备份示例

```bash
docker compose exec -T db pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format=custom \
  > "backup-$(date +%Y%m%d-%H%M%S).dump"
```

## 恢复示例

恢复会覆盖目标数据库，必须在隔离环境先验证。

```bash
docker compose exec -T db pg_restore \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --clean --if-exists \
  < backup-YYYYMMDD-HHMMSS.dump
```

## 自动恢复演练

`scripts/verify-backup-restore.sh` 会完成以下动作：

1. 确认 Docker 中的 PostgreSQL 测试容器正在运行。
2. 拒绝任何名称不以 `_test` 结尾的源库或目标库。
3. 从源测试库创建 PostgreSQL 自定义格式备份并记录 SHA-256。
4. 重建独立的目标测试库，执行 `pg_restore --exit-on-error`。
5. 对业务表、资金流水、审计日志和 Prisma 迁移记录逐表比较行数与完整内容指纹。

本地测试库准备好后执行：

```bash
POSTGRES_CONTAINER=max-promotion-test-db \
POSTGRES_USER=max_promotion \
POSTGRES_PASSWORD=test-only-password \
SOURCE_DB=max_promotion_test \
TARGET_DB=max_promotion_restore_test \
pnpm test:backup-restore
```

脚本通过后只证明“同一数据库实例内完整备份和恢复正确”。正式上线前还必须在不同服务器、不同 PostgreSQL 实例上重复演练，并验证备份加密、异地副本权限和实际恢复耗时。

## 验收

- 账号数量、案件数量、任务数量、资金流水数量一致。
- 每个钱包可用余额与冻结余额，分别等于对应流水累计。
- 抽取至少 20 笔资金业务核对前后余额。
- 记录备份编号、校验值、恢复开始与结束时间、执行人和异常。
