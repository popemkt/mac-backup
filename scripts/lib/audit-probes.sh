# shellcheck shell=bash
#
# The drift audit's one probe mechanism, sourced by
# scripts/audit-system-discrepancies.sh and tested offline by
# scripts/tests/audit-probes.sh.
#
# A probe runs one command in the background and records its stdout, stderr
# and exit status. The caller starts probes, waits, and then reads each one
# only through read_probe_into, so every reading makes the same decision about
# a failed probe. The caller defines record_warn and warn_detail.

AUDIT_PROBE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/audit-probes.XXXXXX")"
AUDIT_PROBE_PIDS=()
AUDIT_PROBE_DONE=()
AUDIT_PROBE_LIMIT=8

cleanup_audit_probes() {
  rm -rf "$AUDIT_PROBE_DIR"
}
trap cleanup_audit_probes EXIT

# Start "$@" as the next probe. Its index is ${#AUDIT_PROBE_PIDS[@]} read just
# before the call. At most AUDIT_PROBE_LIMIT probes run at once.
audit_probe_start() {
  local index active=0 probe
  for probe in "${!AUDIT_PROBE_PIDS[@]}"; do
    [ "${AUDIT_PROBE_DONE[$probe]:-}" = 1 ] || active=$((active + 1))
  done
  if [ "$active" -ge "$AUDIT_PROBE_LIMIT" ]; then
    for probe in "${!AUDIT_PROBE_PIDS[@]}"; do
      if [ "${AUDIT_PROBE_DONE[$probe]:-}" != 1 ]; then
        audit_probe_wait "$probe"
        break
      fi
    done
  fi

  index=${#AUDIT_PROBE_PIDS[@]}
  (
    local rc
    if "$@" >"$AUDIT_PROBE_DIR/$index.out" 2>"$AUDIT_PROBE_DIR/$index.err"; then
      rc=0
    else
      rc=$?
    fi
    printf '%s\n' "$rc" >"$AUDIT_PROBE_DIR/$index.rc"
  ) &
  AUDIT_PROBE_PIDS+=("$!")
}

audit_probe_wait() {
  local index="$1"
  [ "${AUDIT_PROBE_DONE[$index]:-}" = 1 ] && return
  if ! wait "${AUDIT_PROBE_PIDS[$index]}"; then
    : # The worker records its command status; waiting itself must not abort.
  fi
  AUDIT_PROBE_DONE[index]=1
}

audit_probe_wait_all() {
  local index
  for index in "${!AUDIT_PROBE_PIDS[@]}"; do
    audit_probe_wait "$index"
  done
}

audit_probe_output() {
  cat "$AUDIT_PROBE_DIR/$1.out"
}

audit_probe_status() {
  cat "$AUDIT_PROBE_DIR/$1.rc"
}

audit_probe_combined() {
  "$@" 2>&1
}

# read_probe_into <array> <index> <label>
#
# Load a finished probe's non-empty stdout lines into <array> and return 0,
# or warn and return 1 when the probe answered nothing.
#
# The exit status alone does not decide. Several listing commands print their
# whole answer and still exit non-zero: `npm ls -g` exits 1 (ELSPROBLEMS)
# when a global is missing or invalid, which is exactly when the drift must be
# read. So a probe has failed only when it exited non-zero AND printed
# nothing; an empty listing from a probe that exited 0 is a real empty
# inventory. A failed probe never reads as "nothing installed"
# (AGENTS.md "Writing an executor"), and a caller that skips on 1 never
# records a pass from it.
read_probe_into() {
  local dest="$1" index="$2" label="$3" rc
  rc="$(audit_probe_status "$index")"
  mapfile -t "$dest" < <(audit_probe_output "$index" | sed '/^$/d')
  local -n _probe_lines="$dest"
  if [ "$rc" != 0 ] && [ "${#_probe_lines[@]}" -eq 0 ]; then
    record_warn "$label failed (exit $rc); that check did not run"
    warn_detail "$(tail -1 "$AUDIT_PROBE_DIR/$index.err" 2>/dev/null || true)"
    return 1
  fi
}
