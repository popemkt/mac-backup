# shellcheck shell=bash
# Writing a secret file in the edge's secrets directory, shared by the
# first-start generator (unit mcp-edge-secrets, ./default.nix) and the
# command (`mcp-edge-secrets`, ./secrets-cli.sh), which both source it.
# Needs coreutils and openssl, and EDGE_SECRETS_DIR set. Run as root.
#
# A live secret file only ever changes by one rename of a file written whole
# beforehand: interrupted or failing at any point, it holds the old secret or
# the new one, never part of one and never none.

die() {
  echo "mcp-edge-secrets: $*" >&2
  exit 1
}

# put <name>: stdin, whole, to $EDGE_SECRETS_DIR/<name> (0400, root).
put() {
  local name=$1 tmp
  install -d -m 0700 -o root -g root "$EDGE_SECRETS_DIR"
  tmp=$(mktemp "$EDGE_SECRETS_DIR/.$name.XXXXXX")
  cat > "$tmp"
  chmod 0400 "$tmp"
  chown root:root "$tmp"
  mv -f "$tmp" "$EDGE_SECRETS_DIR/$name"
}

# new_secret <name>: a fresh random secret (64 hex digits) as <name>. The
# generator's output is taken whole first and written only if it exited 0
# and is exactly that shape: a generator that fails, or prints a short or
# odd value, leaves <name> as it was.
new_secret() {
  local name=$1 secret
  secret=$(openssl rand -hex 32) || die "openssl failed; $name is unchanged"
  [[ $secret =~ ^[0-9a-f]{64}$ ]] || die "openssl gave no 64-hex-digit secret; $name is unchanged"
  printf '%s\n' "$secret" | put "$name"
}
