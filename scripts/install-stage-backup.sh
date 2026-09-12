#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root" >&2
  exit 77
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_dir="$(cd -- "$script_dir/.." && pwd -P)"
postgres_backup_dir="/var/backups/its-stage/postgresql"
uploads_backup_dir="/var/backups/its-stage/uploads"

for source_file in \
  "$project_dir/scripts/backup-postgres.sh" \
  "$project_dir/scripts/backup-uploads.sh" \
  "$project_dir/deploy/its-stage-backup.service" \
  "$project_dir/deploy/its-stage-backup.timer"; do
  if [[ ! -f "$source_file" ]]; then
    echo "Required backup file is missing: $source_file" >&2
    exit 66
  fi
done

if [[ "$(realpath -m -- "$postgres_backup_dir")" != "/var/backups/its-stage/postgresql" ]] ||
   [[ "$(realpath -m -- "$uploads_backup_dir")" != "/var/backups/its-stage/uploads" ]]; then
  echo "Refusing to create unexpected backup directories" >&2
  exit 64
fi

install -d -o root -g root -m 0700 -- "$postgres_backup_dir" "$uploads_backup_dir"
install -o root -g root -m 0750 \
  "$project_dir/scripts/backup-postgres.sh" \
  /usr/local/sbin/its-stage-postgres-backup
install -o root -g root -m 0750 \
  "$project_dir/scripts/backup-uploads.sh" \
  /usr/local/sbin/its-stage-uploads-backup
install -o root -g root -m 0644 \
  "$project_dir/deploy/its-stage-backup.service" \
  /etc/systemd/system/its-stage-backup.service
install -o root -g root -m 0644 \
  "$project_dir/deploy/its-stage-backup.timer" \
  /etc/systemd/system/its-stage-backup.timer

systemctl daemon-reload
systemctl enable --now its-stage-backup.timer

if [[ "${1:-}" == "--run-now" ]]; then
  systemctl start its-stage-backup.service
fi

systemctl is-active --quiet its-stage-backup.timer
echo "PostgreSQL and uploads backup timer installed"
