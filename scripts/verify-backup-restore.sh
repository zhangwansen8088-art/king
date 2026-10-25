#!/usr/bin/env bash

set -Eeuo pipefail

postgres_container="${POSTGRES_CONTAINER:-max-promotion-test-db}"
postgres_user="${POSTGRES_USER:-max_promotion}"
postgres_password="${POSTGRES_PASSWORD:-test-only-password}"
source_db="${SOURCE_DB:-max_promotion_test}"
target_db="${TARGET_DB:-max_promotion_restore_test}"
backup_file="${BACKUP_FILE:-/tmp/max-promotion-backup-restore.dump}"

if [[ ! "$postgres_container" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo "POSTGRES_CONTAINER 不是合法的容器名称。" >&2
  exit 1
fi

if [[ ! "$source_db" =~ ^[a-zA-Z0-9_]+_test$ ]]; then
  echo "SOURCE_DB 必须以 _test 结尾，拒绝操作非测试库。" >&2
  exit 1
fi

if [[ ! "$target_db" =~ ^[a-zA-Z0-9_]+_test$ ]]; then
  echo "TARGET_DB 必须以 _test 结尾，拒绝覆盖非测试库。" >&2
  exit 1
fi

if [[ "$source_db" == "$target_db" ]]; then
  echo "SOURCE_DB 和 TARGET_DB 不能相同，恢复演练需要独立目标库。" >&2
  exit 1
fi

if [[ "$(docker inspect --format '{{.State.Running}}' "$postgres_container" 2>/dev/null)" != "true" ]]; then
  echo "PostgreSQL 测试容器 $postgres_container 没有运行。" >&2
  exit 1
fi

host_report_file="$(mktemp)"
restored_report_file="$(mktemp)"

cleanup() {
  rm -f "$host_report_file" "$restored_report_file"
  docker exec "$postgres_container" rm -f "$backup_file" >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_psql() {
  docker exec -e "PGPASSWORD=$postgres_password" "$postgres_container" \
    psql --username "$postgres_user" --no-psqlrc --set ON_ERROR_STOP=1 "$@"
}

table_fingerprints() {
  local database="$1"
  local table
  local result

  for table in \
    _prisma_migrations \
    User \
    MerchantProfile \
    Wallet \
    Task \
    Submission \
    Withdrawal \
    LedgerEntry \
    RefreshSession \
    AuditLog; do
    result="$(
      run_psql --dbname "$database" --tuples-only --no-align --command \
        "SELECT count(*) || ':' || COALESCE(md5(string_agg(row_to_json(t)::text, '' ORDER BY t.id)), '') FROM \"$table\" t;"
    )"
    printf '%s %s\n' "$table" "$result"
  done
}

echo "准备恢复目标库 $target_db ..."
run_psql --dbname postgres --command \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$target_db' AND pid <> pg_backend_pid();" \
  >/dev/null
run_psql --dbname postgres --command "DROP DATABASE IF EXISTS \"$target_db\";" >/dev/null
run_psql --dbname postgres --command "CREATE DATABASE \"$target_db\";" >/dev/null

started_at="$SECONDS"
echo "从 $source_db 创建自定义格式备份 ..."
docker exec -e "PGPASSWORD=$postgres_password" "$postgres_container" \
  pg_dump --username "$postgres_user" --dbname "$source_db" --format=custom \
  --no-owner --no-privileges --file "$backup_file"

backup_checksum="$(
  docker exec "$postgres_container" sha256sum "$backup_file" | awk '{print $1}'
)"
echo "备份 SHA-256：$backup_checksum"

echo "恢复到 $target_db 并逐表核对 ..."
docker exec -e "PGPASSWORD=$postgres_password" "$postgres_container" \
  pg_restore --username "$postgres_user" --dbname "$target_db" --clean --if-exists \
  --exit-on-error --no-owner --no-privileges "$backup_file"

table_fingerprints "$source_db" > "$host_report_file"
table_fingerprints "$target_db" > "$restored_report_file"

if ! diff -u "$host_report_file" "$restored_report_file"; then
  echo "备份恢复核对失败：源库与恢复库的数据指纹不一致。" >&2
  exit 1
fi

echo "备份恢复核对通过：10 张表的数据指纹完全一致。"
echo "演练耗时：$((SECONDS - started_at)) 秒。"
