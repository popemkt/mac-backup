# ntfy-publish: publish one message, read from stdin, to a topic on this
# host's ntfy, through its owner-only socket (NTFY_SOCKET, set by the
# wrapper). The token comes from a file, never the command line or the
# environment: the unit's credential `ntfy-token` (LoadCredential=) when
# there is one, else NTFY_TOKEN_FILE, else the owner's ~/.config/ntfy/token
# that ntfy-setup writes.
#
#   echo 'disk full' | ntfy-publish --title 'shared-server' --priority high \
#     --tags warning host-attention
usage() {
  echo "usage: ntfy-publish [--title T] [--priority 1-5|min|low|default|high|urgent] [--tags a,b] TOPIC < message" >&2
  exit 2
}

headers=()
topic=
while [ $# -gt 0 ]; do
  case "$1" in
    --title) [ $# -ge 2 ] || usage; headers+=(--header "X-Title: $2"); shift 2 ;;
    --priority) [ $# -ge 2 ] || usage; headers+=(--header "X-Priority: $2"); shift 2 ;;
    --tags) [ $# -ge 2 ] || usage; headers+=(--header "X-Tags: $2"); shift 2 ;;
    -*) usage ;;
    *) [ -z "$topic" ] || usage; topic="$1"; shift ;;
  esac
done
[[ "$topic" =~ ^[A-Za-z0-9_-]{1,64}$ ]] || usage

if [ -n "${CREDENTIALS_DIRECTORY:-}" ] && [ -r "$CREDENTIALS_DIRECTORY/ntfy-token" ]; then
  token_file="$CREDENTIALS_DIRECTORY/ntfy-token"
else
  token_file="${NTFY_TOKEN_FILE:-$HOME/.config/ntfy/token}"
fi
if [ ! -r "$token_file" ]; then
  echo "ntfy-publish: no token at $token_file (run ntfy-setup as the server's owner; docs/ntfy.md)" >&2
  exit 1
fi
token="$(tr -d '[:space:]' <"$token_file")"
[ -n "$token" ] || { echo "ntfy-publish: $token_file is empty" >&2; exit 1; }

# The Authorization header goes through a file descriptor, so the token is in
# no process's arguments.
curl --fail --silent --show-error --max-time 20 \
  --unix-socket "$NTFY_SOCKET" \
  --header @/dev/fd/3 "${headers[@]}" \
  --data-binary @- \
  "http://localhost/$topic" \
  3< <(printf 'Authorization: Bearer %s\n' "$token") >/dev/null
