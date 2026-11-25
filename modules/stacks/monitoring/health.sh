# monitoring-health: the periodic health checks (./alerts.nix runs it on a
# timer). Each check has a key and is either fine or not; an alert goes out
# only when that changes: once when it goes wrong, once ("Recovered") when it
# is fine again. State is one file per key that is currently wrong, under
# $STATE_DIRECTORY/health; a publish that fails changes no state, so the next
# run tries again, and the run exits 1.
#
# Env: MONITOR_HOST, TOPIC, DISK_PERCENT, MEMORY_AVAILABLE_PERCENT,
# MEMORY_PRESSURE_PERCENT, FAILED_MINUTES, IGNORE_UNITS (newline-separated),
# DRIFT_CHECK (a command, or empty), KEYCLOAK_UNIT (or empty),
# SIGNIN_ERRORS, SIGNIN_WINDOW_MINUTES.
dir="$STATE_DIRECTORY/health"
mkdir -p "$dir"
exec 9>"$dir/.lock"
flock 9

publish_failed=
# check <key> <title> <0 fine|1 wrong> <detail>
check() {
  local key="$1" title="$2" wrong="$3" detail="$4" file="$dir/$1"
  if [ "$wrong" = 1 ] && [ ! -e "$file" ]; then
    if printf '%s\n' "$detail" |
      ntfy-publish --title "$title on $MONITOR_HOST" --priority high --tags warning "$TOPIC"; then
      printf '%s\n' "$detail" >"$file"
      echo "alerted: $key: $detail"
    else
      publish_failed=1
    fi
  elif [ "$wrong" = 0 ] && [ -e "$file" ]; then
    if printf '%s\n' "$detail" |
      ntfy-publish --title "Recovered: $title on $MONITOR_HOST" --tags white_check_mark "$TOPIC"; then
      rm -f "$file"
      echo "recovered: $key: $detail"
    else
      publish_failed=1
    fi
  fi
}

# Disks: every mounted filesystem with a backing store, once per device (the
# store's bind mounts share their device with /).
declare -A seen_device=() checked=()
while read -r source pcent target; do
  [ -n "${seen_device[$source]:-}" ] && continue
  seen_device[$source]=1
  used="${pcent%\%}"
  [[ "$used" =~ ^[0-9]+$ ]] || continue
  key="disk-$(systemd-escape --path "$target")"
  checked[$key]=1
  wrong=0
  [ "$used" -ge "$DISK_PERCENT" ] && wrong=1
  check "$key" "Disk $target full" "$wrong" \
    "$target ($source) is ${used}% full; the threshold is ${DISK_PERCENT}%."
done < <(df --local --output=source,pcent,target \
  -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs -x ramfs -x nsfs -x fuse.portal |
  tail -n +2)
# A filesystem that is gone is no longer full.
for file in "$dir"/disk-*; do
  [ -e "$file" ] || continue
  key="${file##*/}"
  [ -n "${checked[$key]:-}" ] && continue
  target="$(systemd-escape --unescape --path "${key#disk-}")"
  check "$key" "Disk $target full" 0 "$target is no longer mounted."
done

# Memory: little available, or tasks stalled on it (PSI).
total="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
available="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
available_pct=$((available * 100 / total))
stalled="$(awk '/^full/ { sub("avg60=", "", $3); print $3 }' /proc/pressure/memory 2>/dev/null || echo 0)"
wrong=0
if [ "$available_pct" -lt "$MEMORY_AVAILABLE_PERCENT" ] ||
  awk -v s="${stalled:-0}" -v t="$MEMORY_PRESSURE_PERCENT" 'BEGIN { exit !(s >= t) }'; then
  wrong=1
fi
check memory "Memory low" "$wrong" \
  "${available_pct}% of memory available (alert below ${MEMORY_AVAILABLE_PERCENT}%); tasks stalled on memory ${stalled:-0}% of the last minute (alert at ${MEMORY_PRESSURE_PERCENT}%)."

# Units stuck failed: failed for at least FAILED_MINUTES (their first failure
# already alerted through OnFailure=, services only).
uptime_us="$(awk '{ printf "%d", $1 * 1000000 }' /proc/uptime)"
stuck=()
while read -r unit _; do
  [ -n "$unit" ] || continue
  printf '%s\n' "$IGNORE_UNITS" | grep -qxF -- "$unit" && continue
  changed="$(systemctl show --property=StateChangeTimestampMonotonic --value -- "$unit")"
  if [ $(((uptime_us - ${changed:-0}) / 60000000)) -ge "$FAILED_MINUTES" ]; then
    stuck+=("$unit")
  fi
done < <(systemctl list-units --state=failed --plain --no-legend --no-pager)
if [ ${#stuck[@]} -gt 0 ]; then
  check failed-units "Units stuck failed" 1 \
    "Failed for at least ${FAILED_MINUTES} minutes: ${stuck[*]}. systemctl --failed; reset-failed once handled."
else
  check failed-units "Units stuck failed" 0 "No unit has been failed for ${FAILED_MINUTES} minutes."
fi

# The node's serve config against the declared entries (the MCP edge's
# public paths); a tailscaled that cannot be read changes nothing.
if [ -n "$DRIFT_CHECK" ]; then
  set +e
  drift="$("$DRIFT_CHECK" 2>&1)"
  code=$?
  set -e
  case "$code" in
    0) check funnel-drift "Tailscale serve drift" 0 "The serve config matches the declared entries again." ;;
    1) check funnel-drift "Tailscale serve drift" 1 "$drift" ;;
    *) echo "funnel drift: tailscale serve status unreadable; skipped: $drift" >&2 ;;
  esac
fi

# Keycloak's error events (LOGIN_ERROR, CODE_TO_TOKEN_ERROR, ...), which its
# default jboss-logging listener logs at WARN under org.keycloak.events.
# GAP [[01M89T0C8HKD2Q0F4A5KH07Z6D]]: tested only against synthetic lines.
if [ -n "$KEYCLOAK_UNIT" ]; then
  errors="$(journalctl --unit="$KEYCLOAK_UNIT" --since="$SIGNIN_WINDOW_MINUTES min ago" \
    --output=cat --no-pager | grep -E 'org\.keycloak\.events.*type="?[A-Z_]+_ERROR' || true)"
  count=0
  [ -n "$errors" ] && count="$(printf '%s\n' "$errors" | wc -l)"
  wrong=0
  [ "$count" -ge "$SIGNIN_ERRORS" ] && wrong=1
  kinds="$(printf '%s\n' "$errors" | grep -oE 'error="?[a-z_]+' | sed 's/error="\{0,1\}//' | sort | uniq -c | sort -rn | head -5 | tr -s ' \n' ' ' || true)"
  check keycloak-signins "Keycloak sign-in errors" "$wrong" \
    "$count Keycloak error events in the last $SIGNIN_WINDOW_MINUTES minutes (alert at $SIGNIN_ERRORS).${kinds:+ Most common: $kinds}"
fi

[ -z "$publish_failed" ]
