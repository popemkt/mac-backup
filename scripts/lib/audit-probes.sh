# shellcheck shell=bash
#
# The drift audit's probe mechanism, sourced by
# scripts/audit-system-discrepancies.sh.
#
# A probe runs one command in the background and records its stdout, stderr
# and exit status. The caller starts probes, waits, and then reads each one.
# The caller defines record_warn and warn_detail.

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
# Load a finished probe's non-empty stdout lines into <array>, or report the
# probe as failed and return 1. A probe that exited non-zero has not said what
# is installed, so it never reads as an empty inventory (AGENTS.md "Writing
# an executor").
read_probe_into() {
  local dest="$1" index="$2" label="$3" rc
  rc="$(audit_probe_status "$index")"
  if [ "$rc" != 0 ]; then
    record_warn "$label failed (exit $rc); that drift was not checked"
    warn_detail "$(tail -1 "$AUDIT_PROBE_DIR/$index.err" 2>/dev/null || true)"
    return 1
  fi
  mapfile -t "$dest" < <(audit_probe_output "$index" | sed '/^$/d')
}
