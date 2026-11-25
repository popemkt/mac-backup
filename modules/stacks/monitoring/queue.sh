# The queue of failed services the notifier did not alert on one by one
# (./unit-failed.sh queues; ./health.sh sends them as one summary), shared by
# both: `<dir>/pending` is the queue, `pending.sending` the batch being
# sent. Both sides take `.queue.lock`, which is held only for an append or a
# transfer and never while publishing, so a unit appended while a batch is
# taken is never lost. ./queue-check.nix races them.

# queue_append <dir> <unit>
queue_append() {
  local dir="$1" lock
  exec {lock}>>"$dir/.queue.lock"
  flock -w 30 "$lock" || echo "queue: lock held for 30s; appending $2 anyway" >&2
  printf '%s\n' "$2" >>"$dir/pending"
  exec {lock}>&-
}

# queue_take <dir>: move the queue into the batch being sent, keeping a batch a
# run left behind (it died before sending it).
queue_take() {
  local dir="$1" lock
  exec {lock}>>"$dir/.queue.lock"
  flock -w 60 "$lock" || return 1
  if [ -s "$dir/pending" ]; then
    cat "$dir/pending" >>"$dir/pending.sending"
    rm "$dir/pending"
  fi
  exec {lock}>&-
}
