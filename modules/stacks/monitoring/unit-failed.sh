# monitoring-unit-failed@<unit>: alert that a system service failed. Every
# service's OnFailure= starts it (./alerts.nix), with the failed unit's name,
# less `.service`, as the instance. One alert per unit per FAILURE_COOLDOWN
# seconds; a failure within it is only logged. A failed publish records
# nothing, so the next failure tries again.
#
# Env: MONITOR_HOST, TOPIC, FAILURE_COOLDOWN, JOURNAL_LINES, IGNORE_UNITS
# (newline-separated), STATE_DIRECTORY (systemd's).
unit="$1.service"

if printf '%s\n' "$IGNORE_UNITS" | grep -qxF -- "$unit"; then
  echo "$unit is in ignoreUnits; no alert"
  exit 0
fi

dir="$STATE_DIRECTORY/unit-failed"
mkdir -p "$dir"
# One alert at a time, so two failures of one unit cannot both pass the
# cooldown check.
exec 9>"$dir/.lock"
flock 9

stamp="$dir/$unit"
now="$(date +%s)"
if [ -e "$stamp" ]; then
  since=$((now - $(stat -c %Y "$stamp")))
  if [ "$since" -lt "$FAILURE_COOLDOWN" ]; then
    echo "$unit failed again; alerted ${since}s ago, so not again within ${FAILURE_COOLDOWN}s"
    exit 0
  fi
fi

result="$(systemctl show --property=Result --value -- "$unit" || true)"
body="$(
  printf '%s failed on %s (result: %s).\n\n' "$unit" "$MONITOR_HOST" "${result:-unknown}"
  journalctl --unit="$unit" --lines="$JOURNAL_LINES" --no-pager --output=short-iso 2>&1 | cut -c1-300
  printf '\njournalctl -u %s    systemctl status %s\n' "$unit" "$unit"
)"
# ntfy turns a message over 4096 bytes into an attachment.
printf '%s\n' "${body:0:3500}" |
  ntfy-publish --title "$unit failed on $MONITOR_HOST" --priority high --tags warning "$TOPIC"

touch -d "@$now" "$stamp"
echo "alerted: $unit failed"
