# shellcheck shell=bash
# The body of the `adhoc` command (./adhoc.nix wraps it, sets the shell
# options, and exports every ADHOC_* variable below).
#   ADHOC_TAILSCALE     tailscale CLI of this platform (absolute path)
#   ADHOC_SSH           ssh client of this platform (absolute path)
#   ADHOC_SHARED_HOST   host serving the shared endpoint (shared-server)
#   ADHOC_SHARED_USER   account the reverse forward logs in as
#   ADHOC_SHARED_PORT   loopback port the shared endpoint proxies there
#   ADHOC_SHARED_URL    the shared endpoint's public https origin
#   ADHOC_ON_SHARED     1 when this machine is ADHOC_SHARED_HOST, else 0

usage() {
  cat <<'USAGE'
adhoc: publish a local web app on the tailnet, temporarily.

  adhoc <port> [--https=<p>]   serve http://127.0.0.1:<port> on this machine's
                               tailnet name; --https picks the HTTPS port
                               (443, 8443 or 10000) so several apps can coexist
  adhoc --shared <port>        forward <port> to the shared endpoint on
                               shared-server (foreground; Ctrl-C stops it)
  adhoc ls                     what this machine publishes (tailscale serve status)
  adhoc off [--https=<p>]      stop one entry, or every one without the flag
  adhoc -h                     this help
USAGE
}

die() {
  echo "adhoc: $*" >&2
  exit 1
}

ts() {
  "$ADHOC_TAILSCALE" "$@"
}

check_port() {
  if ! [[ $1 =~ ^[0-9]+$ ]] || ((10#$1 < 1 || 10#$1 > 65535)); then
    die "not a port number: $1"
  fi
}

# The HTTPS port out of a --https=<p> argument.
https_port() {
  local value=${1#--https=}
  check_port "$value"
  echo "$((10#$value))"
}

# Node-level serve entries, as "<kind> <port>" lines (kind: https, http, tcp).
# Tailscale Services (svc:*, the declared endpoints) are a separate part of the
# serve config and never show up here.
served() {
  ts serve status --json | jq -r '
    (.TCP // {}) | to_entries[]
    | "\(if .value.HTTPS then "https" elif .value.HTTP then "http" else "tcp" end) \(.key)"'
}

is_served() {
  served | awk -v port="$1" '$2 == port { found = 1 } END { exit !found }'
}

dns_name() {
  local name
  name=$(ts status --json | jq -r '.Self.DNSName // empty')
  name=${name%.}
  [[ -n $name ]] || die "this machine has no tailnet name (is Tailscale signed in and running?)"
  echo "$name"
}

publish() {
  local port=$1 https=$2 args=(serve --bg) url
  if [[ -n $https ]]; then
    args+=("--https=$https")
  else
    https=443
  fi
  if is_served "$https"; then
    die "HTTPS port $https is already served on this machine; not replacing it. Pick another with --https=<443|8443|10000>, or free it with 'adhoc off --https=$https' (see 'adhoc ls')."
  fi
  url="https://$(dns_name)"
  [[ $https == 443 ]] || url+=":$https"
  ts "${args[@]}" "$port"
  echo "$url"
}

# Best-effort description of whatever listens on the shared endpoint's port on
# shared-server, empty when it is free. Runs there, as popemkt.
shared_holder() {
  "$ADHOC_SSH" "$ADHOC_SHARED_USER@$ADHOC_SHARED_HOST" sh -s <<REMOTE
line=\$(ss -H -ltnp "sport = :$ADHOC_SHARED_PORT") || exit 0
[ -n "\$line" ] || exit 0
pid=\$(printf '%s' "\$line" | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2)
if [ -z "\$pid" ]; then
  echo "a process of another account"
  exit 0
fi
unit=\$(ps -o unit= -p "\$pid" | tr -d ' ')
comm=\$(ps -o comm= -p "\$pid")
if [ -n "\$unit" ] && [ "\$unit" != "-" ]; then
  echo "the systemd unit \$unit (\$comm, pid \$pid)"
else
  echo "\$comm (pid \$pid)"
fi
REMOTE
}

shared() {
  local port=$1 holder
  if [[ $ADHOC_ON_SHARED == 1 ]]; then
    echo "This is $ADHOC_SHARED_HOST: nothing to forward. Serve your app on 127.0.0.1:$ADHOC_SHARED_PORT directly and it appears at $ADHOC_SHARED_URL."
    return 0
  fi
  holder=$(shared_holder) || die "could not check port $ADHOC_SHARED_PORT on $ADHOC_SHARED_HOST (ssh $ADHOC_SHARED_USER@$ADHOC_SHARED_HOST failed)"
  if [[ -n $holder ]]; then
    die "port $ADHOC_SHARED_PORT on $ADHOC_SHARED_HOST is already in use by $holder; stop that first, then run this again."
  fi
  echo "$ADHOC_SHARED_URL -> localhost:$port (Ctrl-C to stop)"
  exec "$ADHOC_SSH" -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -R "$ADHOC_SHARED_PORT:localhost:$port" \
    "$ADHOC_SHARED_USER@$ADHOC_SHARED_HOST"
}

off() {
  local https=$1 kind port
  if [[ -n $https ]]; then
    is_served "$https" || die "nothing is served on HTTPS port $https (see 'adhoc ls')."
    ts serve "--https=$https" off
    return 0
  fi
  # Not `tailscale serve reset`: it empties the whole serve config, and on a
  # host that declares Tailscale Services that takes those down with it.
  while read -r kind port; do
    [[ -z $kind ]] || ts serve "--$kind=$port" off
  done < <(served)
}

main() {
  case ${1:-} in
    "" | -h | --help | help)
      usage
      ;;
    ls)
      [[ $# == 1 ]] || die "ls takes no arguments"
      ts serve status
      ;;
    off)
      shift
      case $# in
        0) off "" ;;
        1) [[ $1 == --https=* ]] || die "unexpected argument: $1 (adhoc off [--https=<p>])"
          off "$(https_port "$1")" ;;
        *) die "too many arguments (adhoc off [--https=<p>])" ;;
      esac
      ;;
    --shared)
      [[ $# == 2 ]] || die "usage: adhoc --shared <port>"
      check_port "$2"
      shared "$((10#$2))"
      ;;
    *)
      local port="" https="" arg
      for arg in "$@"; do
        case $arg in
          --https=*) https=$(https_port "$arg") ;;
          -*) die "unknown option: $arg (adhoc -h)" ;;
          *)
            [[ -z $port ]] || die "more than one port given (adhoc -h)"
            check_port "$arg"
            port=$((10#$arg))
            ;;
        esac
      done
      [[ -n $port ]] || die "no port given (adhoc -h)"
      publish "$port" "$https"
      ;;
  esac
}

main "$@"
