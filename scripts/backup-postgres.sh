#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

# 生产备份必须显式提供容器、数据库和目录，避免误用默认值。
postgres_container="${POSTGRES_CONTAINER:?请设置 POSTGRES_CONTAINER}"
postgres_user="${POSTGRES_USER:-max_promotion}"
postgres_password="${POSTGRES_PASSWORD:?请设置 POSTGRES_PASSWORD}"
postgres_db="${POSTGRES_DB:-max_promotion}"
backup_dir="${BACKUP_DIR:?请设置 BACKUP_DIR}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"

if [[ ! "$postgres_container" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo "POSTGRES_CONTAINER 不是合法的容器名称。" >&2
  exit 1
fi

if [[ ! "$postgres_user" =~ ^[a-zA-Z0-9_]+$ ]] || [[ ! "$postgres_db" =~ ^[a-zA-Z0-9_]+$ ]]; then
  echo "POSTGRES_USER 和 POSTGRES_DB 只能包含字母、数字和下划线。" >&2
  exit 1
fi

if [[ ! "$retention_days" =~ ^[1-9][0-9]*$ ]] || ((retention_days > 3650)); then
  echo "BACKUP_RETENTION_DAYS 必须是 1 到 3650 之间的整数。" >&2
  exit 1
fi

if [[ "$(docker inspect --format '{{.State.Running}}' "$postgres_container" 2>/dev/null)" != "true" ]]; then
  echo "PostgreSQL 容器 $postgres_container 没有运行。" >&2
  exit 1
fi

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
backup_dir="$(cd "$backup_dir" && pwd -P)"

# 使用系统文件锁阻止同一数据库的备份任务重叠，进程退出后锁会自动释放。
lock_file="$backup_dir/.${postgres_db}.backup.lock"
lock_kind=""
if command -v flock > /dev/null 2>&1; then
  exec 9> "$lock_file"
  if ! flock -n 9; then
    echo "已有备份任务正在运行：$lock_file" >&2
    exit 1
  fi
  lock_kind="flock"
elif command -v shlock > /dev/null 2>&1; then
  if ! shlock -f "$lock_file" -p "$$"; then
    echo "已有备份任务正在运行：$lock_file" >&2
    exit 1
  fi
  lock_kind="shlock"
else
  echo "系统缺少 flock 或 shlock，无法安全阻止并发备份。" >&2
  exit 1
fi
chmod 600 "$lock_file"

temp_dump=""
temp_checksum=""

cleanup() {
  [[ -z "$temp_dump" ]] || rm -f "$temp_dump"
  [[ -z "$temp_checksum" ]] || rm -f "$temp_checksum"
  # shlock 不会随进程退出自动删除文件，只删除仍由当前进程持有的锁。
  if [[ "$lock_kind" == "shlock" ]] &&
    [[ "$(cat "$lock_file" 2>/dev/null || true)" == "$$" ]]; then
    rm -f "$lock_file"
  fi
}
trap cleanup EXIT

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_name="${postgres_db}-${timestamp}.dump"
backup_file="$backup_dir/$backup_name"
checksum_file="$backup_file.sha256"

if [[ -e "$backup_file" ]] || [[ -e "$checksum_file" ]]; then
  echo "同一时间戳的备份文件已存在，拒绝覆盖：$backup_file" >&2
  exit 1
fi

temp_dump="$(mktemp "$backup_dir/.${postgres_db}-${timestamp}.partial.XXXXXX")"
temp_checksum="$(mktemp "$backup_dir/.${postgres_db}-${timestamp}.checksum.XXXXXX")"

# 密码只通过子进程环境传入，不写入命令参数、日志或备份文件。
export PGPASSWORD="$postgres_password"
docker exec -e PGPASSWORD -i "$postgres_container" \
  pg_dump \
  --username "$postgres_user" \
  --dbname "$postgres_db" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --lock-wait-timeout=30s \
  > "$temp_dump"
unset PGPASSWORD

if [[ ! -s "$temp_dump" ]]; then
  echo "pg_dump 未生成有效备份文件。" >&2
  exit 1
fi

# 通过 pg_restore 读取目录验证自定义格式完整，避免保存被截断的归档。
docker exec -i "$postgres_container" pg_restore --list < "$temp_dump" > /dev/null

if command -v sha256sum > /dev/null 2>&1; then
  checksum="$(sha256sum "$temp_dump" | awk '{print $1}')"
elif command -v shasum > /dev/null 2>&1; then
  checksum="$(shasum -a 256 "$temp_dump" | awk '{print $1}')"
else
  echo "系统缺少 sha256sum 或 shasum，无法生成校验值。" >&2
  exit 1
fi

printf '%s  %s\n' "$checksum" "$backup_name" > "$temp_checksum"
chmod 600 "$temp_dump" "$temp_checksum"
mv "$temp_dump" "$backup_file"
temp_dump=""
mv "$temp_checksum" "$checksum_file"
temp_checksum=""

echo "备份完成：$backup_file"
echo "备份 SHA-256：$checksum"

# 只清理本数据库命名格式内、超过保留期的归档和校验文件。
find "$backup_dir" -maxdepth 1 -type f \
  \( -name "${postgres_db}-*.dump" -o -name "${postgres_db}-*.dump.sha256" \) \
  -mtime +"$retention_days" -print -delete

echo "备份保留策略：删除超过 $retention_days 天的旧文件。"
