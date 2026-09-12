#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

backup_dir="/var/backups/its-stage/postgresql"
retention_days="${ITS_BACKUP_RETENTION_DAYS:-14}"

if [[ "$(realpath -m -- "$backup_dir")" != "/var/backups/its-stage/postgresql" ]]; then
  echo "Refusing to use an unexpected backup directory" >&2
  exit 64
fi
if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 || retention_days > 365 )); then
  echo "ITS_BACKUP_RETENTION_DAYS must be between 1 and 365" >&2
  exit 64
fi

for name in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then
    echo "Required database setting is missing: $name" >&2
    exit 78
  fi
done
if [[ ! "$DB_PORT" =~ ^[0-9]+$ ]] || (( DB_PORT < 1 || DB_PORT > 65535 )); then
  echo "DB_PORT must be a valid TCP port" >&2
  exit 78
fi

for command in pg_dump pg_restore realpath; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command" >&2
    exit 69
  fi
done

install -d -o root -g root -m 0700 -- "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_file="$backup_dir/its-stage-$timestamp.dump"
if [[ -e "$final_file" ]]; then
  echo "Backup already exists: $final_file" >&2
  exit 73
fi

temporary_file="$(mktemp "$backup_dir/.its-stage-$timestamp.XXXXXX.dump")"
cleanup() {
  if [[ -n "$temporary_file" ]]; then
    rm -f -- "$temporary_file"
  fi
}
trap cleanup EXIT

PGPASSWORD="$DB_PASSWORD" pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="$temporary_file"

pg_restore --list "$temporary_file" >/dev/null
chmod 0600 -- "$temporary_file"
mv -- "$temporary_file" "$final_file"
temporary_file=""

# The target is a fixed, validated directory and only files created by this
# backup job are eligible for retention cleanup.
find "$backup_dir" \
  -mindepth 1 \
  -maxdepth 1 \
  -type f \
  -name 'its-stage-*.dump' \
  -mtime "+$retention_days" \
  -delete

echo "PostgreSQL backup completed: $final_file"
