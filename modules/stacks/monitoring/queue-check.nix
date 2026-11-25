{ pkgs }:

# checks.x86_64-linux.monitoring-queue: ./queue.sh under contention. In each
# round, many notifiers append at once while a health run keeps taking the
# queue and "sending" each batch; every unit appended must be sent exactly
# once.
pkgs.runCommand "monitoring-queue-check"
  {
    nativeBuildInputs = [
      pkgs.bash
      pkgs.coreutils
      pkgs.util-linux
    ];
  }
  ''
    bash -euo pipefail <<'SH'
    source ${./queue.sh}
    units=400
    for round in 1 2 3 4 5; do
      QUEUE_DIR=$(mktemp -d)
      sent="$QUEUE_DIR/sent"
      : > "$sent"
      (
        for i in $(seq "$units"); do queue_append "$QUEUE_DIR" "u$i" & done
        wait
      ) &
      appenders=$!
      deliver() {
        queue_take "$QUEUE_DIR"
        if [ -e "$QUEUE_DIR/pending.sending" ]; then
          cat "$QUEUE_DIR/pending.sending" >> "$sent"
          rm "$QUEUE_DIR/pending.sending"
        fi
      }
      while kill -0 "$appenders" 2>/dev/null; do deliver; done
      wait "$appenders"
      deliver
      got=$(sort -u "$sent" | wc -l)
      total=$(wc -l < "$sent")
      echo "round $round: $got of $units sent ($total lines)"
      if [ "$got" -ne "$units" ] || [ "$total" -ne "$units" ]; then
        echo "round $round lost or repeated units" >&2
        exit 1
      fi
    done
    SH
    touch "$out"
  ''
