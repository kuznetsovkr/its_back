#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

state_dir="/var/lib/its-stage-monitor"
health_state_file="$state_dir/health.state"
recipient_cache_file="$state_dir/recipients"
journal_cursor_file="$state_dir/journal.cursor"
restart_count_file="$state_dir/restart.count"
monitor_url="${ITS_MONITOR_URL:-${PUBLIC_APP_URL:-https://stage.its-site.ru}}"
disk_warning_percent="${ITS_MONITOR_DISK_WARNING_PERCENT:-80}"
disk_critical_percent="${ITS_MONITOR_DISK_CRITICAL_PERCENT:-90}"
backup_max_age_hours="${ITS_MONITOR_BACKUP_MAX_AGE_HOURS:-30}"
hostname_label="$(hostname -f 2>/dev/null || hostname)"

for value_name in disk_warning_percent disk_critical_percent backup_max_age_hours; do
  value="${!value_name}"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "Invalid numeric monitor setting: $value_name" >&2
    exit 64
  fi
done
if (( disk_warning_percent < 1 || disk_warning_percent >= disk_critical_percent || disk_critical_percent > 100 )); then
  echo "Disk thresholds are invalid" >&2
  exit 64
fi
if (( backup_max_age_hours < 1 || backup_max_age_hours > 168 )); then
  echo "ITS_MONITOR_BACKUP_MAX_AGE_HOURS must be between 1 and 168" >&2
  exit 64
fi
if [[ ! "$monitor_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "ITS_MONITOR_URL must be an HTTPS origin" >&2
  exit 64
fi

install -d -o root -g root -m 0700 -- "$state_dir"

append_chat_ids() {
  local raw="$1"
  local target="$2"
  local chat_id
  while IFS= read -r chat_id; do
    chat_id="${chat_id//[[:space:]]/}"
    if [[ "$chat_id" =~ ^-?[0-9]+$ ]]; then
      echo "$chat_id" >> "$target"
    fi
  # Command substitution removes the final newline from psql output. Add it
  # back so `read` also processes a single recipient without a trailing LF.
  done < <(printf '%s\n' "$raw" | tr ',' '\n')
}

refresh_recipients() {
  local temporary_file
  temporary_file="$(mktemp "$state_dir/.recipients.XXXXXX")"

  if [[ -n "${ITS_MONITOR_TELEGRAM_BOT_TOKEN:-}" ]]; then
    append_chat_ids "${ITS_MONITOR_TELEGRAM_CHAT_IDS:-}" "$temporary_file"
  else
    append_chat_ids "${TELEGRAM_ORDER_CHAT_IDS:-${TELEGRAM_CHAT_ID:-}}" "$temporary_file"
    if [[ -n "${DB_HOST:-}" && -n "${DB_PORT:-}" && -n "${DB_NAME:-}" &&
          -n "${DB_USER:-}" && -n "${DB_PASSWORD:-}" ]]; then
      local database_recipients=""
      database_recipients="$(
        PGPASSWORD="$DB_PASSWORD" PGCONNECT_TIMEOUT=5 psql \
          --host="$DB_HOST" \
          --port="$DB_PORT" \
          --username="$DB_USER" \
          --dbname="$DB_NAME" \
          --tuples-only \
          --no-align \
          --command='SELECT "chatId" FROM telegram_channel_subscribers WHERE channel = '\''orders'\'' AND "isActive" = true;' \
          2>/dev/null || true
      )"
      append_chat_ids "$database_recipients" "$temporary_file"
    fi
  fi

  sort -u -o "$temporary_file" "$temporary_file"
  if [[ -s "$temporary_file" ]]; then
    chmod 0600 -- "$temporary_file"
    mv -f -- "$temporary_file" "$recipient_cache_file"
  else
    rm -f -- "$temporary_file"
  fi
}

send_telegram() {
  local message="${1//\\n/$'\n'}"
  local token="${ITS_MONITOR_TELEGRAM_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"
  if [[ ! "$token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
    echo "Monitoring Telegram token is not configured" >&2
    return 1
  fi

  refresh_recipients
  if [[ ! -s "$recipient_cache_file" ]]; then
    echo "Monitoring Telegram recipients are not configured" >&2
    return 1
  fi

  local proxy_arguments=()
  if [[ -n "${TELEGRAM_PROXY_URL:-}" ]]; then
    proxy_arguments+=(--proxy "$TELEGRAM_PROXY_URL")
    if [[ -n "${TELEGRAM_PROXY_USERNAME:-}" && -n "${TELEGRAM_PROXY_PASSWORD:-}" ]]; then
      proxy_arguments+=(--proxy-user "$TELEGRAM_PROXY_USERNAME:$TELEGRAM_PROXY_PASSWORD")
    fi
  fi

  local chat_id response successful=0
  while IFS= read -r chat_id; do
    response="$(curl \
      --silent \
      --show-error \
      --fail \
      --max-time 20 \
      "${proxy_arguments[@]}" \
      --data-urlencode "chat_id=$chat_id" \
      --data-urlencode "text=$message" \
      "https://api.telegram.org/bot${token}/sendMessage" 2>/dev/null || true)"
    if grep -q '"ok":true' <<< "$response"; then
      successful=$((successful + 1))
    else
      echo "Failed to send a monitoring notification to one recipient" >&2
    fi
  done < "$recipient_cache_file"

  (( successful > 0 ))
}

latest_file_age_hours() {
  local directory="$1"
  local pattern="$2"
  local latest_timestamp
  latest_timestamp="$(find "$directory" -mindepth 1 -maxdepth 1 -type f -name "$pattern" -size +0c -printf '%T@\n' 2>/dev/null | sort -n | tail -1)"
  if [[ -z "$latest_timestamp" ]]; then
    echo "missing"
    return
  fi
  latest_timestamp="${latest_timestamp%%.*}"
  echo $(( ($(date +%s) - latest_timestamp) / 3600 ))
}

collect_health_issues() {
  local output_file="$1"
  : > "$output_file"

  local unit result
  for unit in its-stage nginx postgresql redis-server; do
    if ! systemctl is-active --quiet "$unit"; then
      echo "Сервис $unit не работает" >> "$output_file"
    fi
  done
  for unit in its-stage-backup.timer its-stage-maintenance.timer its-stage-monitor.timer; do
    if ! systemctl is-active --quiet "$unit"; then
      echo "Таймер $unit не активен" >> "$output_file"
    fi
  done
  for unit in its-stage-backup.service its-stage-maintenance.service; do
    result="$(systemctl show "$unit" --property=Result --value 2>/dev/null || true)"
    if [[ -n "$result" && "$result" != "success" ]]; then
      echo "Последний запуск $unit завершился с результатом: $result" >> "$output_file"
    fi
  done

  if ! curl --silent --show-error --fail --max-time 15 --output /dev/null "$monitor_url/"; then
    echo "Главная страница недоступна: $monitor_url" >> "$output_file"
  fi
  if ! curl --silent --show-error --fail --max-time 15 --output /dev/null "$monitor_url/api/clothing-types"; then
    echo "API каталога недоступно" >> "$output_file"
  fi

  local disk_usage inode_usage
  disk_usage="$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  inode_usage="$(df -Pi / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  if (( disk_usage >= disk_critical_percent )); then
    echo "Критически мало места на диске: занято ${disk_usage}%" >> "$output_file"
  elif (( disk_usage >= disk_warning_percent )); then
    echo "Заканчивается место на диске: занято ${disk_usage}%" >> "$output_file"
  fi
  if (( inode_usage >= disk_critical_percent )); then
    echo "Критически мало inode: занято ${inode_usage}%" >> "$output_file"
  elif (( inode_usage >= disk_warning_percent )); then
    echo "Заканчиваются inode: занято ${inode_usage}%" >> "$output_file"
  fi

  local age
  age="$(latest_file_age_hours /var/backups/its-stage/postgresql 'its-stage-*.dump')"
  if [[ "$age" == "missing" ]]; then
    echo "Не найдена резервная копия PostgreSQL" >> "$output_file"
  elif (( age > backup_max_age_hours )); then
    echo "Резервная копия PostgreSQL устарела: ${age} ч" >> "$output_file"
  fi
  age="$(latest_file_age_hours /var/backups/its-stage/uploads 'its-stage-uploads-*.tar.gz')"
  if [[ "$age" == "missing" ]]; then
    echo "Не найдена резервная копия uploads" >> "$output_file"
  elif (( age > backup_max_age_hours )); then
    echo "Резервная копия uploads устарела: ${age} ч" >> "$output_file"
  fi

  if [[ -n "${ITS_MONITOR_HEARTBEAT_URL:-}" ]] &&
     ! curl --silent --show-error --fail --max-time 15 --output /dev/null "$ITS_MONITOR_HEARTBEAT_URL"; then
    echo "Не удалось отправить внешний heartbeat" >> "$output_file"
  fi

  sort -u -o "$output_file" "$output_file"
}

current_journal_cursor() {
  journalctl -u its-stage -n 0 --show-cursor --no-pager 2>/dev/null \
    | sed -n 's/^-- cursor: //p' \
    | tail -1
}

check_new_application_errors() {
  if [[ ! -s "$journal_cursor_file" ]]; then
    current_journal_cursor > "$journal_cursor_file"
    return 0
  fi

  local cursor journal_output next_cursor error_count
  cursor="$(cat "$journal_cursor_file")"
  if ! journal_output="$(journalctl -u its-stage --after-cursor "$cursor" --show-cursor --priority=err --no-pager 2>/dev/null)"; then
    current_journal_cursor > "$journal_cursor_file"
    return 0
  fi
  next_cursor="$(sed -n 's/^-- cursor: //p' <<< "$journal_output" | tail -1)"
  error_count="$(sed '/^-- cursor:/d;/^-- No entries --$/d;/^[[:space:]]*$/d' <<< "$journal_output" | wc -l)"

  if (( error_count > 0 )); then
    if ! send_telegram "🔴 ITS stage: в журнале приложения появились ошибки: $error_count. Проверьте: journalctl -u its-stage -p err\nСервер: $hostname_label"; then
      return 1
    fi
  fi
  if [[ -n "$next_cursor" ]]; then
    printf '%s\n' "$next_cursor" > "$journal_cursor_file"
  fi
}

check_application_restarts() {
  local current_count previous_count=0
  current_count="$(systemctl show its-stage --property=NRestarts --value 2>/dev/null || echo 0)"
  [[ "$current_count" =~ ^[0-9]+$ ]] || current_count=0
  if [[ -s "$restart_count_file" ]]; then
    previous_count="$(cat "$restart_count_file")"
  fi

  if [[ "$previous_count" =~ ^[0-9]+$ ]] && (( current_count > previous_count )); then
    if ! send_telegram "🟠 ITS stage: приложение автоматически перезапускалось. Было: $previous_count, стало: $current_count.\nСервер: $hostname_label"; then
      return 1
    fi
  fi
  printf '%s\n' "$current_count" > "$restart_count_file"
}

if [[ "${1:-}" == "--initialize" ]]; then
  refresh_recipients
  if [[ ! -s "$recipient_cache_file" ]]; then
    echo "Cannot initialize monitoring without Telegram recipients" >&2
    exit 78
  fi
  current_journal_cursor > "$journal_cursor_file"
  systemctl show its-stage --property=NRestarts --value > "$restart_count_file"
  : > "$health_state_file"
  echo "Monitoring state initialized"
  exit 0
fi

if [[ "${1:-}" == "--test-alert" ]]; then
  send_telegram "🟢 ITS stage: мониторинг подключён и уведомления работают.\nСервер: $hostname_label"
  echo "Test monitoring notification sent"
  exit 0
fi

if [[ $# -ne 0 ]]; then
  echo "Usage: monitor-stage.sh [--initialize|--test-alert]" >&2
  exit 64
fi

current_health_file="$(mktemp "$state_dir/.health.XXXXXX")"
trap 'rm -f -- "$current_health_file"' EXIT
collect_health_issues "$current_health_file"
previous_health="$(cat "$health_state_file" 2>/dev/null || true)"
current_health="$(cat "$current_health_file")"

if [[ "$current_health" != "$previous_health" ]]; then
  if [[ -n "$current_health" ]]; then
    message="🔴 ITS stage: обнаружены проблемы:\n$(sed 's/^/• /' "$current_health_file")\nСервер: $hostname_label"
  else
    message="🟢 ITS stage: показатели снова в норме.\nСервер: $hostname_label"
  fi
  send_telegram "$message"
  install -o root -g root -m 0600 -- "$current_health_file" "$health_state_file"
fi

check_application_restarts
check_new_application_errors
echo "Stage monitoring check completed"
