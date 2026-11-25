# The queue of failed services the notifier did not alert on one by one
# (./unit-failed.sh queues; ./health.sh sends them as one summary): a spool
# directory, `<dir>/queue`, with one file per queued failure. An entry is
# written under a temporary name and renamed into place, so a reader sees
# whole entries or none, and nothing is ever appended to a shared file, so
# no lock is needed. ./queue-check.nix races them.

# queue_append <dir> <unit>
queue_append() {
  local spool="$1/queue" tmp
  mkdir -p "$spool" || return 1
  tmp="$(mktemp "$spool/.tmp.XXXXXXXX")" || return 1
  printf '%s\n' "$2" >"$tmp" || { rm -f -- "$tmp"; return 1; }
  mv -- "$tmp" "$spool/entry.${tmp##*/.tmp.}" || { rm -f -- "$tmp"; return 1; }
}

# queue_send <dir> <sender>: hand the queued units, one per line and each
# once, to <sender> (a command or function that publishes them), then delete
# exactly the entries it was given. Returns 0 when there was nothing to
# send or it was sent; 1 when <sender> failed; 2 when an entry could not be
# read. Only the first deletes anything.
queue_send() {
  local spool="$1/queue" sender="$2" entry unit
  local -a entries=() units=()
  for entry in "$spool"/entry.*; do
    [ -e "$entry" ] || continue
    if ! unit="$(cat -- "$entry")"; then
      echo "queue: cannot read $entry; nothing sent or deleted" >&2
      return 2
    fi
    entries+=("$entry")
    units+=("$unit")
  done
  [ ${#entries[@]} -gt 0 ] || return 0
  if ! printf '%s\n' "${units[@]}" | sort -u | "$sender"; then
    return 1
  fi
  rm -f -- "${entries[@]}"
}
