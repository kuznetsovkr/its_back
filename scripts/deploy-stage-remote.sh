#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

if [[ $# -ne 4 ]]; then
  echo "Usage: deploy-stage-remote.sh RELEASE_ID FRONTEND_SHA256 BACKEND_SHA256 DOMAIN" >&2
  exit 64
fi

release_id="$1"
frontend_sha256="$2"
backend_sha256="$3"
domain="$4"

if [[ ! "$release_id" =~ ^[0-9]{14}-[a-f0-9]{8}-[a-f0-9]{8}$ ]]; then
  echo "Invalid release identifier" >&2
  exit 64
fi
if [[ ! "$frontend_sha256" =~ ^[a-f0-9]{64}$ || ! "$backend_sha256" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Invalid archive checksum" >&2
  exit 64
fi
if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Invalid staging domain" >&2
  exit 64
fi

archive_prefix="$HOME/.its-deploy-$release_id"
frontend_archive="$archive_prefix-frontend.tar.gz"
backend_archive="$archive_prefix-backend.tar.gz"
remote_helper="$archive_prefix-remote.sh"
release_dir="/srv/its/releases/$release_id"
current_link="/srv/its/current"
next_link="/srv/its/.current-$release_id"
lock_file="/srv/its/.deploy.lock"
previous_release=""
switched=0
migrations_applied=0

cleanup_uploads() {
  rm -f -- "$frontend_archive" "$backend_archive" "$remote_helper"
}

rollback_after_error() {
  local exit_code=$?
  trap - ERR
  set +e

  if [[ "$switched" -eq 1 && -n "$previous_release" && -d "$previous_release" ]]; then
    local rollback_link="/srv/its/.rollback-$release_id"
    rm -f -- "$rollback_link"
    if ln -s "$previous_release" "$rollback_link" && mv -Tf "$rollback_link" "$current_link"; then
      sudo systemctl restart its-stage
      echo "Deployment failed; application was rolled back to $previous_release" >&2
    else
      echo "CRITICAL: deployment failed and automatic rollback also failed" >&2
    fi
  fi

  if [[ "$migrations_applied" -eq 1 ]]; then
    echo "Database migrations were applied and were not automatically reverted" >&2
  fi

  exit "$exit_code"
}

trap cleanup_uploads EXIT
trap rollback_after_error ERR

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another staging deployment is already running" >&2
  exit 75
fi

for required_file in "$frontend_archive" "$backend_archive" "$remote_helper"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Required upload is missing: $required_file" >&2
    exit 66
  fi
done

if [[ -e "$release_dir" ]]; then
  echo "Release already exists: $release_dir" >&2
  exit 73
fi

echo "$frontend_sha256  $frontend_archive" | sha256sum --check --strict -
echo "$backend_sha256  $backend_archive" | sha256sum --check --strict -

assert_safe_archive() {
  local archive="$1"
  local entry

  while IFS= read -r entry; do
    case "$entry" in
      /*|../*|*/../*|*/..)
        echo "Unsafe archive entry: $entry" >&2
        return 1
        ;;
    esac
  done < <(tar -tzf "$archive")
}

assert_safe_archive "$frontend_archive"
assert_safe_archive "$backend_archive"

mkdir -p "$release_dir/frontend" "$release_dir/backend"
tar -xzf "$frontend_archive" --no-same-owner --no-same-permissions -C "$release_dir/frontend"
tar -xzf "$backend_archive" --no-same-owner --no-same-permissions -C "$release_dir/backend"

# The restrictive process umask protects backend code and configuration. The
# compiled frontend is public, so nginx must be able to traverse its release
# directory and read every generated asset.
chmod 0755 "$release_dir" "$release_dir/frontend"
find "$release_dir/frontend" -type d -exec chmod 0755 {} +
find "$release_dir/frontend" -type f -exec chmod 0644 {} +

if [[ ! -f "$release_dir/frontend/index.html" || ! -f "$release_dir/backend/package.json" ]]; then
  echo "Release archives do not contain the expected application files" >&2
  exit 65
fi

cat >"$release_dir/RELEASE" <<EOF
release=$release_id
deployed_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
frontend_sha256=$frontend_sha256
backend_sha256=$backend_sha256
EOF

echo "Installing backend production dependencies"
cd "$release_dir/backend"
npm ci --omit=dev --no-audit --no-fund

echo "Running backend tests on the server"
npm test

echo "Applying database migrations"
migration_unit="its-stage-migrate-$release_id"
sudo systemd-run \
  --quiet \
  --wait \
  --pipe \
  --collect \
  --unit="$migration_unit" \
  --property=Type=oneshot \
  --property=User=itsdeploy \
  --property=Group=itsdeploy \
  --property="WorkingDirectory=$release_dir/backend" \
  --property=EnvironmentFile=/etc/its-site/stage.env \
  /usr/bin/npm run db:migrate
migrations_applied=1

previous_release="$(readlink -f "$current_link")"
if [[ -z "$previous_release" || ! -d "$previous_release" ]]; then
  echo "Current release cannot be resolved" >&2
  exit 72
fi

sudo nginx -t
ln -s "$release_dir" "$next_link"
mv -Tf "$next_link" "$current_link"
switched=1

sudo systemctl restart its-stage

smoke_test() {
  local attempt
  for attempt in $(seq 1 15); do
    if sudo systemctl is-active --quiet its-stage \
      && curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:5000/api/clothing-types" \
      && curl -fsS --max-time 10 "https://$domain/" | grep -Eq '<title>[^<]+</title>' \
      && curl -fsS --max-time 10 -o /dev/null "https://$domain/order"; then
      return 0
    fi
    sleep 2
  done

  sudo systemctl status its-stage --no-pager >&2 || true
  sudo journalctl -u its-stage -n 80 --no-pager >&2 || true
  return 1
}

smoke_test

trap - ERR
echo "DEPLOY_OK release=$release_dir previous=$previous_release"
