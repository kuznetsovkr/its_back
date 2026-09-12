#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

release_root="/srv/its/releases"
current_link="/srv/its/current"
lock_file="/srv/its/.deploy.lock"
keep_count="${ITS_RELEASES_TO_KEEP:-5}"
dry_run=0

if [[ $# -gt 1 ]] || [[ $# -eq 1 && "$1" != "--dry-run" ]]; then
  echo "Usage: prune-releases.sh [--dry-run]" >&2
  exit 64
fi
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
fi

if [[ "$(realpath -m -- "$release_root")" != "/srv/its/releases" ]]; then
  echo "Refusing to use an unexpected release directory" >&2
  exit 64
fi
if [[ ! "$keep_count" =~ ^[0-9]+$ ]] || (( keep_count < 2 || keep_count > 20 )); then
  echo "ITS_RELEASES_TO_KEEP must be between 2 and 20" >&2
  exit 64
fi
if [[ ! -d "$release_root" ]]; then
  echo "Release directory does not exist" >&2
  exit 66
fi

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Skipping release cleanup because a deployment is running"
  exit 0
fi

current_release="$(readlink -f -- "$current_link")"
if [[ -z "$current_release" || "$(dirname -- "$current_release")" != "$release_root" ]]; then
  echo "Current release cannot be resolved safely" >&2
  exit 72
fi

mapfile -t releases < <(
  find "$release_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | grep -E '^([0-9]{14}-[a-f0-9]{8}-[a-f0-9]{8}|[0-9]{8}-[a-f0-9]{7,8}-[a-f0-9]{7,8})$' \
    | sort -r
)

declare -A protected=()
protected["$(basename -- "$current_release")"]=1
for ((index = 0; index < ${#releases[@]} && index < keep_count; index += 1)); do
  protected["${releases[$index]}"]=1
done

removed=0
reclaimed_bytes=0
for name in "${releases[@]}"; do
  if [[ -n "${protected[$name]:-}" ]]; then
    continue
  fi

  candidate="$release_root/$name"
  resolved_candidate="$(realpath -e -- "$candidate")"
  if [[ "$resolved_candidate" == "$current_release" ]] ||
     [[ "$(dirname -- "$resolved_candidate")" != "$release_root" ]]; then
    echo "Refusing unsafe release target: $candidate" >&2
    exit 72
  fi

  bytes="$(du -sb -- "$resolved_candidate" | awk '{print $1}')"
  if (( dry_run == 1 )); then
    echo "[dry-run] remove $resolved_candidate ($bytes bytes)"
  else
    rm -rf --one-file-system -- "$resolved_candidate"
  fi
  reclaimed_bytes=$((reclaimed_bytes + bytes))
  removed=$((removed + 1))
done

echo "Release cleanup completed: kept=${#protected[@]} removed=$removed reclaimed_bytes=$reclaimed_bytes dry_run=$dry_run"
