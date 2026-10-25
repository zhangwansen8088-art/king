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

## 验收

- 账号数量、案件数量、任务数量、资金流水数量一致。
- 每个钱包可用余额与冻结余额，分别等于对应流水累计。
- 抽取至少 20 笔资金业务核对前后余额。
- 记录备份编号、校验值、恢复开始与结束时间、执行人和异常。
