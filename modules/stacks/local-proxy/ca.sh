# shellcheck shell=bash
# Make sure the local proxy's root CA exists and that Caddy's state under it
# is current, then exit, or run a command (Caddy) with the intermediate
# lifetime the root allows. Usage:
#   local-proxy-ca <state-dir> <ca-name> [command...]
#
# The root's critical name constraint permits DNS names under `localhost`
# and excludes every IPv4 and IPv6 address, so even a stolen key cannot vouch
# for another site's DNS name or for any IP address. Its key never leaves
# <state-dir>/ca/private (root-only, 0700/0600); the certificate is public
# (0644) so the person can enroll it in their trust settings. Caddy derives
# its intermediate and each site's certificate from it, and renews those
# itself (lifetimes: ./caddyfile.nix).
#
# A missing, unreadable, mismatched or soon-expiring root (under a year left),
# or one missing any of these constraints, is replaced, and Caddy's
# certificates under the old one are dropped. A new root is untrusted until it
# is enrolled again, which the readiness check reports.
# GAP [[01M7WSREFP2F1354V6J5A0YDZK]] the local proxy converges its CA only when its daemon starts.
#
# Caddy keeps a stored intermediate whatever lifetime is configured, until
# its own renewal window. So one that ends over a week before the root (one
# made under a shorter lifetime, or by an older version of this stack) is
# retired here, with the site certificates it signed, and Caddy makes a
# new one that lasts as long as the root. With a command, the root's
# remaining validity less a day is exported as
# LOCAL_PROXY_INTERMEDIATE_LIFETIME, which ./caddyfile.nix reads: always
# shorter than the root's remaining validity, as Caddy requires.
set -euo pipefail

state=$1
name=$2
shift 2
key=$state/ca/private/root.key
crt=$state/ca/root.crt
authority=$state/caddy/pki/authorities/local
day=$((24 * 3600))

# The name constraint, and the subtrees a sound root's printout must name.
constraint="critical, permitted;DNS:localhost, excluded;IP:0.0.0.0/0.0.0.0, excluded;IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0"
subtrees=("DNS:localhost" "IP:0.0.0.0/0.0.0.0" "IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0")

umask 077
install -d -m 0755 "$state" "$state/ca"
install -d -m 0700 "$state/ca/private" "$state/caddy"

current() {
  [ -s "$key" ] && [ -s "$crt" ] || return 1
  openssl x509 -in "$crt" -noout -checkend $((365 * day)) >/dev/null || return 1
  [ "$(openssl x509 -in "$crt" -noout -pubkey)" = "$(openssl pkey -in "$key" -pubout)" ] || return 1
  printout=$(openssl x509 -in "$crt" -noout -ext nameConstraints)
  grep -qF "Name Constraints: critical" <<<"$printout" || return 1
  for subtree in "${subtrees[@]}"; do
    grep -qF "$subtree" <<<"$printout" || return 1
  done
}

# A certificate's notAfter, in seconds since the epoch.
ends() {
  date -d "$(openssl x509 -in "$1" -noout -enddate | cut -d= -f2)" +%s
}

create() {
  echo "local-proxy: creating root CA \"$name\" in $state/ca"
  work=$(mktemp -d "$state/ca/private/new.XXXXXX")
  trap 'rm -rf "$work"' EXIT
  cat >"$work/root.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $name
[root]
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = $constraint
EOF
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$work/root.key"
  openssl req -x509 -new -key "$work/root.key" -sha256 -days 3650 \
    -config "$work/root.cnf" -extensions root -out "$work/root.crt"
  chmod 0600 "$work/root.key"
  chmod 0644 "$work/root.crt"

  # Certificates Caddy made under the old root would not chain to the new one.
  rm -rf "$state/caddy/pki" "$state/caddy/certificates/local"
  mv -f "$work/root.key" "$key"
  mv -f "$work/root.crt" "$crt"
  # Before the exec below, which skips the EXIT trap.
  rm -rf "$work"
  trap - EXIT
}

current || create

if [ -e "$authority/intermediate.crt" ]; then
  if ! intermediate_ends=$(ends "$authority/intermediate.crt") ||
    [ "$intermediate_ends" -lt $(($(ends "$crt") - 7 * day)) ]; then
    echo "local-proxy: retiring the intermediate that ends before the root, and the site certificates it signed"
    rm -rf "$authority" "$state/caddy/certificates/local"
  fi
fi

[ $# -gt 0 ] || exit 0
LOCAL_PROXY_INTERMEDIATE_LIFETIME=$(($(ends "$crt") - $(date +%s) - day))s
export LOCAL_PROXY_INTERMEDIATE_LIFETIME
exec "$@"
