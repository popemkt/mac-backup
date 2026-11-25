# monitoring-unit-failed@<unit>: alert that a system service failed. Every
# service's OnFailure= starts it (./alerts.nix), with the failed unit's name,
# less `.service`, as the instance.
#
#   - One alert per unit per FAILURE_COOLDOWN seconds; a failure within it is
#     only logged.
#   - At most BURST_LIMIT alerts per BURST_WINDOW seconds across every unit:
#     one incident often fails many units (or template instances) at once.
#     A failure beyond that is queued in `pending`, which the next health
#     check run (./health.sh) sends as one summary.
#   - Notifiers take turns (a lock), each waiting at most LOCK_WAIT seconds;
#     one that cannot get its turn queues its unit the same way.
#   - A failed publish records nothing, so the next failure tries again.
#
# Env: NTFY_PUBLISH, MONITOR_HOST, TOPIC, FAILURE_COOLDOWN, BURST_LIMIT,
# BURST_WINDOW, JOURNAL_LINES, IGNORE_UNITS (newline-separated),
# STATE_DIRECTORY (systemd's).
unit="$1.service"
LOCK_WAIT=30

if printf '%s\n' "$IGNORE_UNITS" | grep -qxF -- "$unit"; then
  echo "$unit is in ignoreUnits; no alert"
  exit 0
fi

dir="$STATE_DIRECTORY/unit-failed"
mkdir -p "$dir"
queue() {
  printf '%s\n' "$unit" >>"$dir/pending"
  echo "$unit failed; $1, so it goes in the next summary"
  exit 0
}
exec 9>"$dir/.lock"
flock -w "$LOCK_WAIT" 9 || queue "other alerts held the lock for ${LOCK_WAIT}s"

stamp="$dir/$unit"
now="$(date +%s)"
if [ -e "$stamp" ]; then
  since=$((now - $(stat -c %Y "$stamp")))
  if [ "$since" -lt "$FAILURE_COOLDOWN" ]; then
    echo "$unit failed again; alerted ${since}s ago, so not again within ${FAILURE_COOLDOWN}s"
    exit 0
  fi
fi

# The alerts sent within the burst window, one time per line.
sent="$dir/sent"
touch "$sent"
awk -v since=$((now - BURST_WINDOW)) '$1 > since' "$sent" >"$sent.new"
mv "$sent.new" "$sent"
if [ "$(wc -l <"$sent")" -ge "$BURST_LIMIT" ]; then
  touch -d "@$now" "$stamp"
  queue "${BURST_LIMIT} alerts went out in the last ${BURST_WINDOW}s"
fi

result="$(systemctl show --property=Result --value -- "$unit" || true)"
body="$(
  printf '%s failed on %s (result: %s).\n\n' "$unit" "$MONITOR_HOST" "${result:-unknown}"
  journalctl --unit="$unit" --lines="$JOURNAL_LINES" --no-pager --output=short-iso 2>&1 | cut -c1-300
  printf '\njournalctl -u %s    systemctl status %s\n' "$unit" "$unit"
)"
# ntfy turns a message over 4096 bytes into an attachment.
printf '%s\n' "${body:0:3500}" |
  "$NTFY_PUBLISH" --title "$unit failed on $MONITOR_HOST" --priority high --tags warning "$TOPIC"

touch -d "@$now" "$stamp"
echo "$now" >>"$sent"
echo "alerted: $unit failed"
