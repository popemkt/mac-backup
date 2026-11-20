# Run interactively as the service owner. SQLite ntfy stores credentials
# under the service's data directory. The token file is for host publishers.
owner="$(id -un)"
entry="$(jq -er --arg owner "$owner" 'to_entries[] | select(.value.owner == $owner) | .key' "$SERVERS")"
url="$(jq -er --arg entry "$entry" '.[$entry].baseUrl' "$SERVERS")"
socket="$(jq -er --arg entry "$entry" '.[$entry].socket' "$SERVERS")"
curl --fail --silent --show-error --unix-socket "$socket" http://localhost/v1/health >/dev/null

umask 077
dir="$HOME/.config/ntfy"
mkdir -p "$dir"
exec 9>"$dir/setup.lock"
flock 9
container="app-$entry"
case "${1:-}" in
  "") action=add; role=(--role=admin) ;;
  --reset-password) action=change-pass; role=() ;;
  *) echo "usage: ntfy-setup [--reset-password]" >&2; exit 2 ;;
esac

if [[ "$action" == change-pass || ! -s "$dir/token" ]]; then
  # Pass the password by environment so it does not appear in the command line.
  password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  NTFY_PASSWORD="$password" podman exec --env NTFY_PASSWORD "$container" ntfy user "$action" "${role[@]}" "$owner"
  printf 'Username: %s\nPassword: %s\n' "$owner" "$password"
fi

if [[ ! -s "$dir/token" ]]; then
  token="$(podman exec "$container" ntfy token add --label host-publisher "$owner" | sed -n 's/^token \(tk_[^ ]*\) created .*/\1/p')"
  [[ -n "$token" ]]
  temp="$(mktemp "$dir/.token.XXXXXX")"
  trap 'rm -f "$temp"' EXIT
  printf '%s\n' "$token" >"$temp"
  mv "$temp" "$dir/token"
fi
if [[ "$url" == "http://localhost" ]]; then
  printf 'Local socket: %s\n' "$socket"
else
  printf 'Server: %s\n' "$url"
fi
printf 'Host token: %s/token\nSee docs/ntfy.md for publishing and phone setup.\n' "$dir"
