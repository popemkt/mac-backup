# kb-remote's sandbox, probed from inside it (B2). Runs as the
# kb-remote-sandbox-check unit, which shares kb-remote's attribute set
# (./remote-mcp.nix), so each probe meets the unit's actual restrictions.
# Every failed probe prints FAIL and the unit fails, which keeps kb-remote
# from starting.
#
#   ROOT_LISTING  what `/` must list, space-separated and sorted
#   ABSENT        paths that must not exist
#   STORE         the store's root (read-write)
#   STATE         the unit's state directory (read-write)
#   SOCKET_DIR    the socket's directory (the only entry under /run)

failed=0
ok() { echo "ok: $*"; }
fail() {
  echo "FAIL: $*"
  failed=1
}

# A directory's entries, sorted, on one line.
entries() {
  find "$1" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort | paste -sd' '
}

listing=$(entries /)
if [ "$listing" = "$ROOT_LISTING" ]; then
  ok "/ lists only the allow-list ($listing)"
else
  fail "/ lists '$listing', allow-list '$ROOT_LISTING'"
fi

# /run: the socket's directory, and journald's logging sockets, which systemd
# binds into every unit's namespace for its output (nothing else of systemd's).
run=$(entries /run)
journal=$(find /run/systemd 2> /dev/null | sort | paste -sd' ')
if [ "$run" = "$(basename "$SOCKET_DIR") systemd" ] &&
  [ "$journal" = "/run/systemd /run/systemd/journal /run/systemd/journal/dev-log /run/systemd/journal/socket /run/systemd/journal/stdout" ]; then
  ok "/run holds only $SOCKET_DIR and journald's sockets"
else
  fail "/run lists '$run'; /run/systemd holds '$journal'"
fi

for path in $ABSENT; do
  if [ -e "$path" ] || [ -L "$path" ]; then
    fail "$path is visible"
  else
    ok "$path is absent"
  fi
done

# Above the store, each directory holds only the way down to it: nothing else
# of the owner's home.
dir=$STORE
while [ "$dir" != / ]; do
  parent=$(dirname "$dir")
  if [ "$parent" != / ]; then
    found=$(entries "$parent")
    if [ "$found" = "$(basename "$dir")" ]; then
      ok "$parent holds only $(basename "$dir")"
    else
      fail "$parent lists '$found'"
    fi
  fi
  dir=$parent
done

# No network and no IPC: no TCP, UDP or netlink socket can even be made, and
# the host's abstract sockets (one is listening under this name in the VM
# test) are out of reach.
if python3 -I - << 'EOF'; then
import socket, sys

bad = []
for family, kind in (
    (socket.AF_INET, socket.SOCK_STREAM),
    (socket.AF_INET6, socket.SOCK_STREAM),
    (socket.AF_INET, socket.SOCK_DGRAM),
    (socket.AF_NETLINK, socket.SOCK_RAW),
):
    try:
        socket.socket(family, kind).close()
        bad.append(f"socket({family!r}, {kind!r}) was allowed")
    except OSError:
        pass
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
try:
    s.connect("\0kb-remote-sandbox-probe")
    bad.append("connected to the abstract socket @kb-remote-sandbox-probe")
except OSError:
    pass
for line in bad:
    print(line)
sys.exit(1 if bad else 0)
EOF
  ok "no TCP, UDP, netlink or abstract sockets"
else
  fail "a network or abstract socket was reachable"
fi

# Its own PID namespace: only this unit's processes are visible, none of
# oauth2-proxy's, which runs as the same user, so no /proc/<pid>/root leads
# into another unit's mount view. PID 1 is this unit's own main process.
foreign=""
for status in /proc/[0-9]*/status; do
  name=$(sed -n 's/^Name:\t//p' "$status" 2> /dev/null) || continue
  case $name in
    oauth2-proxy | nginx | java | systemd | kb | bun) foreign="$foreign $name" ;;
  esac
done
if [ -z "$foreign" ] && [ "$(sed -n 's/^Name:\t//p' /proc/1/status)" != systemd ]; then
  ok "only this unit's processes are visible ($(find /proc -mindepth 1 -maxdepth 1 -name '[0-9]*' | wc -l) pids)"
else
  fail "other processes are visible:$foreign"
fi

# Writes land only in the store and the unit's state.
for dir in / /nix/store /run /var /home "$(dirname "$STORE")"; do
  if touch "$dir/.kb-remote-sandbox-probe" 2> /dev/null; then
    rm -f "$dir/.kb-remote-sandbox-probe"
    fail "wrote to $dir"
  else
    ok "cannot write to $dir"
  fi
done
for dir in "$STORE" "$STATE"; do
  if touch "$dir/.kb-remote-sandbox-probe" && rm "$dir/.kb-remote-sandbox-probe"; then
    ok "can write to $dir"
  else
    fail "cannot write to $dir"
  fi
done

exit "$failed"
