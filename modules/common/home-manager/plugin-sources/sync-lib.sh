# Shared by the plugin executors' sync scripts, bb-plugins-sync
# (../bb-plugins/sync.sh) and agent-plugins-sync
# (modules/darwin/home-manager/agent-plugins/sync.sh), which put it before
# their own text; they define cu (coreutils' bin) and flock by absolute path.
# Both run inside Home Manager activation, which must never abort over a
# plugin, so neither helper exits: each warns and returns non-zero.

warn() { echo "warning: $*" >&2; }

# lock_state <dir> <what>: create <dir> and hold <dir>/.lock on fd 9 until
# the script exits, so one sync runs at a time (activation and rebuild's or a
# person's own run can overlap), held from the listing on so the second
# sees what the first did. <what> names what a failure skips.
lock_state() {
  if ! "$cu/mkdir" -p "$1"; then
    warn "cannot create $1; skipped $2"
    return 1
  fi
  if ! exec 9>>"$1/.lock"; then
    warn "cannot open $1/.lock; skipped $2"
    return 1
  fi
  if ! "$flock" -w 900 9; then
    warn "another sync held $1/.lock for 15 minutes; skipped $2"
    return 1
  fi
}
