# shellcheck shell=bash
# Make sure the local proxy's root CA exists, then exit. Usage:
#   local-proxy-ca <state-dir> <ca-name>
#
# The root's critical name constraint permits DNS names under `localhost`
# and excludes every IPv4 and IPv6 address, so even a stolen key cannot vouch
# for another site's DNS name or for any IP address. Its key never leaves
# <state-dir>/ca/private (root-only, 0700/0600); the certificate is public
# (0644) so the person can enroll it in their trust settings. Caddy derives
# its intermediate and each site's short-lived certificate from it, and
# renews those itself.
#
# A missing, unreadable, mismatched or soon-expiring root (under a year left),
# or one missing any of these constraints, is replaced, and Caddy's
# certificates under the old one are dropped. A new root is untrusted until it
# is enrolled again, which the readiness check reports.
set -euo pipefail

state=$1
name=$2
key=$state/ca/private/root.key
crt=$state/ca/root.crt

# The name constraint, and the subtrees a sound root's printout must name.
constraint="critical, permitted;DNS:localhost, excluded;IP:0.0.0.0/0.0.0.0, excluded;IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0"
subtrees=("DNS:localhost" "IP:0.0.0.0/0.0.0.0" "IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0")

umask 077
install -d -m 0755 "$state" "$state/ca"
install -d -m 0700 "$state/ca/private" "$state/caddy"

current() {
  [ -s "$key" ] && [ -s "$crt" ] || return 1
  openssl x509 -in "$crt" -noout -checkend $((365 * 24 * 3600)) >/dev/null || return 1
  [ "$(openssl x509 -in "$crt" -noout -pubkey)" = "$(openssl pkey -in "$key" -pubout)" ] || return 1
  printout=$(openssl x509 -in "$crt" -noout -ext nameConstraints)
  grep -qF "Name Constraints: critical" <<<"$printout" || return 1
  for subtree in "${subtrees[@]}"; do
    grep -qF "$subtree" <<<"$printout" || return 1
  done
}

if current; then
  exit 0
fi

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
