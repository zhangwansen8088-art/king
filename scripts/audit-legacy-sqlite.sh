#!/usr/bin/env bash

# 旧系统 SQLite 只读审计：不创建副本、不写入源库、不连接 PostgreSQL。
set -Eeuo pipefail

legacy_path="${1:-${LEGACY_SQLITE:-}}"

if [[ -z "$legacy_path" ]]; then
  echo "用法：bash scripts/audit-legacy-sqlite.sh /绝对路径/promotion.sqlite" >&2
  exit 2
fi

if [[ "$legacy_path" != /* ]]; then
  echo "旧数据库必须使用绝对路径。" >&2
  exit 2
fi

if [[ "$legacy_path" == *'?'* || "$legacy_path" == *'#'* ]]; then
  echo "路径不能包含问号或井号，避免 SQLite URI 指向错误文件。" >&2
  exit 2
fi

if [[ ! -f "$legacy_path" || ! -r "$legacy_path" ]]; then
  echo "旧数据库不存在或不可读：$legacy_path" >&2
  exit 2
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "缺少 sqlite3，无法执行旧数据审计。" >&2
  exit 2
fi

# 非空 WAL 表示主文件不是完整快照。此时不能使用 immutable 模式读取。
if [[ -s "${legacy_path}-wal" ]]; then
  echo "检测到非空 WAL：${legacy_path}-wal" >&2
  echo "请先在隔离环境生成一致性快照，再审计快照；本次拒绝读取不完整数据。" >&2
  exit 2
fi

uri_path="${legacy_path// /%20}"
legacy_uri="file:${uri_path}?mode=ro&immutable=1"

query() {
  sqlite3 -batch -noheader "$legacy_uri" "PRAGMA query_only=ON; $1"
}

scalar() {
  query "$1"
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

hash_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

required_tables=(
  business_user
  business_wallet
  business_task
  business_submission
  business_ledger
  business_recharge
  business_withdrawal
  business_audit_log
)

for table in "${required_tables[@]}"; do
  exists="$(scalar "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$table';")"
  if [[ "$exists" != "1" ]]; then
    echo "缺少旧系统表：$table" >&2
    exit 1
  fi
done

integrity="$(query 'PRAGMA integrity_check;')"
if [[ "$integrity" != "ok" ]]; then
  echo "SQLite 完整性检查失败：" >&2
  echo "$integrity" >&2
  exit 1
fi

failures=0

check_zero() {
  local label="$1"
  local sql="$2"
  local count
  count="$(scalar "$sql")"
  printf '%-32s %s\n' "$label" "$count"
  if [[ "$count" != "0" ]]; then
    failures=$((failures + 1))
  fi
}

echo "旧数据库：$legacy_path"
printf '%-32s %s\n' "文件 SHA-256" "$(hash_file "$legacy_path")"
printf '%-32s %s\n' "逻辑 SHA-256（.dump）" "$(sqlite3 -batch "$legacy_uri" .dump | hash_stream)"
echo

echo "业务表行数"
for table in "${required_tables[@]}"; do
  printf '%-32s %s\n' "$table" "$(scalar "SELECT COUNT(*) FROM $table;")"
done

echo
echo "状态汇总"
query "SELECT 'task', status, COUNT(*) FROM business_task GROUP BY status
       UNION ALL SELECT 'submission', status, COUNT(*) FROM business_submission GROUP BY status
       UNION ALL SELECT 'recharge', status, COUNT(*) FROM business_recharge GROUP BY status
       UNION ALL SELECT 'withdrawal', status, COUNT(*) FROM business_withdrawal GROUP BY status
       ORDER BY 1, 2;"

echo
echo "钱包与流水累计"
query "SELECT 'wallet', SUM(available_cents), SUM(frozen_cents), COUNT(*)
         FROM business_wallet
       UNION ALL
       SELECT 'ledger', COALESCE(SUM(available_delta), 0),
              COALESCE(SUM(frozen_delta), 0), COUNT(*)
         FROM business_ledger;"

echo
echo "关键数据质量检查"
check_zero \
  "钱包和流水不一致账号" \
  "SELECT COUNT(*) FROM (
     SELECT w.user_id
     FROM business_wallet w
     LEFT JOIN business_ledger l ON l.user_id = w.user_id
     GROUP BY w.user_id, w.available_cents, w.frozen_cents
     HAVING w.available_cents <> COALESCE(SUM(l.available_delta), 0)
         OR w.frozen_cents <> COALESCE(SUM(l.frozen_delta), 0)
   );"
check_zero \
  "重复用户名" \
  "SELECT COUNT(*) FROM (
     SELECT lower(trim(username))
     FROM business_user
     GROUP BY lower(trim(username))
     HAVING COUNT(*) > 1
   );"
check_zero \
  "重复幂等键" \
  "SELECT COUNT(*) FROM (
     SELECT idempotency_key
     FROM business_ledger
     GROUP BY idempotency_key
     HAVING COUNT(*) > 1
   );"
check_zero \
  "无钱包账号" \
  "SELECT COUNT(*)
   FROM business_user u
   LEFT JOIN business_wallet w ON w.user_id = u.id
   WHERE w.user_id IS NULL;"
check_zero \
  "无对应用户的钱包" \
  "SELECT COUNT(*)
   FROM business_wallet w
   LEFT JOIN business_user u ON u.id = w.user_id
   WHERE u.id IS NULL;"
check_zero \
  "无对应商户的任务" \
  "SELECT COUNT(*)
   FROM business_task t
   LEFT JOIN business_user u ON u.id = t.merchant_id
   WHERE u.id IS NULL;"
check_zero \
  "无对应推广记录的资金流水" \
  "SELECT COUNT(*)
   FROM business_ledger l
   WHERE l.reference_type = 'submission'
     AND NOT EXISTS (
       SELECT 1 FROM business_submission s WHERE s.id = l.reference_id
     );"
check_zero \
  "返佣层级无效的流水" \
  "SELECT COUNT(*)
   FROM business_ledger
   WHERE kind = 'rebate'
     AND idempotency_key NOT GLOB 'submission:*:rebate:[123]';"

foreign_key_violations="$(query 'PRAGMA foreign_key_check;')"
if [[ -n "$foreign_key_violations" ]]; then
  echo "外键检查发现违规：" >&2
  echo "$foreign_key_violations" >&2
  failures=$((failures + 1))
else
  printf '%-32s %s\n' "外键违规" "0"
fi

echo
echo "迁移预警"
printf '%-32s %s\n' \
  "自动通过且无审核人" \
  "$(scalar "SELECT COUNT(*) FROM business_submission WHERE status='approved' AND reviewer_id IS NULL;")"
printf '%-32s %s\n' \
  "旧密码哈希（非 Argon2id）" \
  "$(scalar "SELECT COUNT(*) FROM business_user WHERE password_hash NOT LIKE '\$argon2id\$%';")"
printf '%-32s %s\n' \
  "演示资金流水" \
  "$(scalar "SELECT COUNT(*) FROM business_ledger WHERE kind='seed_recharge';")"
printf '%-32s %s\n' \
  "二、三级返佣流水" \
  "$(scalar "SELECT COUNT(*) FROM business_ledger WHERE kind='rebate' AND idempotency_key GLOB 'submission:*:rebate:[23]';")"
printf '%-32s %s\n' \
  "旧充值单" \
  "$(scalar "SELECT COUNT(*) FROM business_recharge;")"

echo
if (( failures > 0 )); then
  echo "审计未通过：发现 $failures 类阻断问题，禁止进入导入步骤。" >&2
  exit 1
fi

echo "只读审计通过；该结果只证明旧库内部一致，不代表数据已由业务对方确认真实。"
