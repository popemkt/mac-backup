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
# exactly the entries it was given. An entry that cannot be read is moved to
# `queue/bad`, so it never blocks the rest; <sender> is called with the
# number of entries kept there and that directory, so it can say so, and is
# called even with no units when an entry was just set aside. Returns 0 when
# there was nothing to send or it was sent; 1 when <sender> failed (nothing
# deleted); 2 when an unreadable entry could not be set aside (nothing sent
# or deleted).
queue_send() {
  local spool="$1/queue" sender="$2" entry unit bad=0 set_aside=0
  local -a entries=() units=()
  for entry in "$spool"/entry.*; do
    [ -e "$entry" ] || continue
    if unit="$(cat -- "$entry")"; then
      entries+=("$entry")
      units+=("$unit")
    elif mkdir -p "$spool/bad" && mv -- "$entry" "$spool/bad/"; then
      echo "queue: cannot read $entry; set aside in $spool/bad" >&2
      set_aside=1
    else
      echo "queue: cannot read $entry, nor set it aside; nothing sent or deleted" >&2
      return 2
    fi
  done
  [ ${#entries[@]} -gt 0 ] || [ "$set_aside" = 1 ] || return 0
  if [ -d "$spool/bad" ]; then
    bad="$(find "$spool/bad" -mindepth 1 -maxdepth 1 | wc -l)"
  fi
  if ! { [ ${#units[@]} -eq 0 ] || printf '%s\n' "${units[@]}" | sort -u; } | "$sender" "$bad" "$spool/bad"; then
    return 1
  fi
  [ ${#entries[@]} -eq 0 ] || rm -f -- "${entries[@]}"
}
