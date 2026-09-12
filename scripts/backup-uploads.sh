#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

source_dir="/srv/its/shared/uploads"
backup_dir="/var/backups/its-stage/uploads"
retention_days="${ITS_BACKUP_RETENTION_DAYS:-14}"

if [[ "$(realpath -m -- "$source_dir")" != "/srv/its/shared/uploads" ]]; then
  echo "Refusing to read an unexpected uploads directory" >&2
  exit 64
fi
if [[ "$(realpath -m -- "$backup_dir")" != "/var/backups/its-stage/uploads" ]]; then
  echo "Refusing to use an unexpected backup directory" >&2
  exit 64
fi
if [[ ! -d "$source_dir" ]]; then
  echo "Uploads directory does not exist" >&2
  exit 66
fi
if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 || retention_days > 365 )); then
  echo "ITS_BACKUP_RETENTION_DAYS must be between 1 and 365" >&2
  exit 64
fi

for command in tar realpath mktemp find; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: $command" >&2
    exit 69
  fi
done

install -d -o root -g root -m 0700 -- "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_file="$backup_dir/its-stage-uploads-$timestamp.tar.gz"
if [[ -e "$final_file" ]]; then
  echo "Backup already exists: $final_file" >&2
  exit 73
fi

temporary_file="$(mktemp "$backup_dir/.its-stage-uploads-$timestamp.XXXXXX.tar.gz")"
cleanup() {
  if [[ -n "$temporary_file" ]]; then
    rm -f -- "$temporary_file"
  fi
}
trap cleanup EXIT

tar \
  --create \
  --gzip \
  --file="$temporary_file" \
  --directory="$(dirname -- "$source_dir")" \
  "$(basename -- "$source_dir")"

tar --list --gzip --file="$temporary_file" >/dev/null
chmod 0600 -- "$temporary_file"
mv -- "$temporary_file" "$final_file"
temporary_file=""

find "$backup_dir" \
  -mindepth 1 \
  -maxdepth 1 \
  -type f \
  -name 'its-stage-uploads-*.tar.gz' \
  -mtime "+$retention_days" \
  -delete

echo "Uploads backup completed: $final_file"
