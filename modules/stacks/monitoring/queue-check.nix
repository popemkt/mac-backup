{ pkgs }:

# checks.x86_64-linux.monitoring-queue: ./queue.sh, without a VM.
#   - Races: in each round many notifiers queue at once while a health run
#     keeps sending; every unit must be sent exactly once.
#   - An entry that cannot be read is set aside in queue/bad and reported;
#     the readable ones are still sent.
#   - A send that fails deletes nothing; one that succeeds deletes exactly
#     the entries it sent.
pkgs.runCommand "monitoring-queue-check"
  {
    nativeBuildInputs = [
      pkgs.bash
      pkgs.coreutils
      pkgs.findutils
    ];
  }
  ''
    bash -euo pipefail <<'SH'
    source ${./queue.sh}
    fail() { echo "FAIL: $*" >&2; exit 1; }
    entries() { find "$1/queue" -maxdepth 1 -name 'entry.*' | wc -l; }

    units=400
    for round in 1 2 3 4 5; do
      dir=$(mktemp -d)
      sent="$dir/sent"
      : > "$sent"
      deliver() { cat >> "$sent"; }
      (
        for i in $(seq "$units"); do queue_append "$dir" "u$i" & done
        wait
      ) &
      appenders=$!
      while kill -0 "$appenders" 2>/dev/null; do queue_send "$dir" deliver; done
      wait "$appenders"
      queue_send "$dir" deliver
      got=$(sort -u "$sent" | wc -l)
      total=$(wc -l < "$sent")
      echo "round $round: $got of $units sent ($total lines)"
      [ "$got" -eq "$units" ] && [ "$total" -eq "$units" ] || fail "round $round lost or repeated units"
      [ "$(entries "$dir")" -eq 0 ] || fail "round $round left entries behind"
    done

    dir=$(mktemp -d)
    called="$dir/called"
    record() { cat > "$called"; echo "$*" > "$called.args"; }
    refuse() { cat > /dev/null; return 1; }
    queue_append "$dir" a.service
    queue_append "$dir" b.service
    # An entry that cannot be read (here a directory where a file should be):
    # it is set aside in queue/bad, and the readable ones still go out.
    mkdir "$dir/queue/entry.unreadable"

    status=0; queue_send "$dir" refuse || status=$?
    [ "$status" -eq 1 ] || fail "failed send: status $status, not 1"
    [ "$(entries "$dir")" -eq 2 ] || fail "failed send: entries were deleted"
    [ -e "$dir/queue/bad/entry.unreadable" ] || fail "unreadable entry not set aside in queue/bad"
    echo "failed send: nothing deleted; the unreadable entry is set aside"

    status=0; queue_send "$dir" record || status=$?
    [ "$status" -eq 0 ] || fail "send past an unreadable entry: status $status, not 0"
    [ "$(cat "$called")" = "$(printf 'a.service\nb.service')" ] || fail "sent: $(cat "$called")"
    [ "$(cat "$called.args")" = "1 $dir/queue/bad" ] || fail "sender not told of the unreadable entry: $(cat "$called.args")"
    [ "$(entries "$dir")" -eq 0 ] || fail "sent: entries left behind"
    [ -e "$dir/queue/bad/entry.unreadable" ] || fail "the unreadable entry was deleted"
    echo "sent: both units once, both entries deleted, the unreadable one kept and reported"

    rm "$called"
    queue_send "$dir" record
    [ ! -e "$called" ] || fail "nothing new queued, yet something was sent"
    echo "nothing queued: nothing sent"
    SH
    touch "$out"
  ''
