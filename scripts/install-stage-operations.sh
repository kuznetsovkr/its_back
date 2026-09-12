#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root" >&2
  exit 77
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_dir="$(cd -- "$script_dir/.." && pwd -P)"
state_dir="/var/lib/its-stage-monitor"

required_files=(
  "$project_dir/scripts/monitor-stage.sh"
  "$project_dir/scripts/cleanup-order-uploads.js"
  "$project_dir/scripts/prune-releases.sh"
  "$project_dir/deploy/its-stage-monitor.service"
  "$project_dir/deploy/its-stage-monitor.timer"
  "$project_dir/deploy/its-stage-maintenance.service"
  "$project_dir/deploy/its-stage-maintenance.timer"
)
for source_file in "${required_files[@]}"; do
  if [[ ! -f "$source_file" ]]; then
    echo "Required operations file is missing: $source_file" >&2
    exit 66
  fi
done

for shell_script in \
  "$project_dir/scripts/monitor-stage.sh" \
  "$project_dir/scripts/prune-releases.sh"; do
  bash -n "$shell_script"
done
node --check "$project_dir/scripts/cleanup-order-uploads.js"

install -d -o root -g root -m 0700 -- "$state_dir"
install -o root -g root -m 0750 \
  "$project_dir/scripts/monitor-stage.sh" \
  /usr/local/sbin/its-stage-monitor
install -o root -g root -m 0644 \
  "$project_dir/deploy/its-stage-monitor.service" \
  /etc/systemd/system/its-stage-monitor.service
install -o root -g root -m 0644 \
  "$project_dir/deploy/its-stage-monitor.timer" \
  /etc/systemd/system/its-stage-monitor.timer
install -o root -g root -m 0644 \
  "$project_dir/deploy/its-stage-maintenance.service" \
  /etc/systemd/system/its-stage-maintenance.service
install -o root -g root -m 0644 \
  "$project_dir/deploy/its-stage-maintenance.timer" \
  /etc/systemd/system/its-stage-maintenance.timer

systemctl daemon-reload
systemctl enable --now its-stage-monitor.timer its-stage-maintenance.timer

run_monitor_action() {
  local action="$1"
  local unit_name="its-stage-monitor-setup-$$-${action#--}"
  local properties=(--property=Type=oneshot --property=EnvironmentFile=/etc/its-site/stage.env)
  if [[ -f /etc/its-site/monitor.env ]]; then
    properties+=(--property=EnvironmentFile=/etc/its-site/monitor.env)
  fi
  systemd-run \
    --quiet \
    --wait \
    --pipe \
    --collect \
    --unit="$unit_name" \
    "${properties[@]}" \
    /usr/local/sbin/its-stage-monitor "$action"
}

run_monitor_action --initialize

if [[ "${1:-}" == "--send-test" ]]; then
  run_monitor_action --test-alert
elif [[ -n "${1:-}" ]]; then
  echo "Usage: install-stage-operations.sh [--send-test]" >&2
  exit 64
fi

systemctl start its-stage-monitor.service
systemctl is-active --quiet its-stage-monitor.timer
systemctl is-active --quiet its-stage-maintenance.timer
echo "Stage monitoring and retention timers installed"
