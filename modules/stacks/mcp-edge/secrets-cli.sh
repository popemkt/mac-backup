# shellcheck shell=bash
# The body of `mcp-edge-secrets` (./secrets-cli.nix wraps it, sets the shell
# options, and exports every EDGE_* variable below). Run as root (sudo).
#   EDGE_SECRETS_DIR    the machine-state secrets directory (0700, root)
#   EDGE_CLIENTS        the declared clients (gemini claude), space-separated
#   EDGE_KEYCLOAK       Keycloak on loopback (http://127.0.0.1:<port>)
#   EDGE_REALM          the edge's realm
#   EDGE_ADMIN_CLIENT   Keycloak's admin service client (master realm)
#   EDGE_ADMIN_SECRET   its secret's file name in EDGE_SECRETS_DIR
#
# No secret value ever reaches a command line (every local user can read
# those), and none is printed except by `client`, on purpose.

usage() {
  cat <<'USAGE'
mcp-edge-secrets: the MCP edge's machine-state secrets (run with sudo).

  google                 save the Google OAuth client (prompts for its ID and
                         secret; the secret is not shown as you type)
  status                 which secret files exist, their modes and ages
                         (never their values)
  client <name>          print a client's secret, to paste into its vendor
  rotate <name>          give a client a new secret
  revoke-all [--yes]     sign every connector out: end all sessions, rotate
                         the realm's keys, restart oauth2-proxy

Remotely: ssh -t shared-server sudo mcp-edge-secrets google
USAGE
}

die() {
  echo "mcp-edge-secrets: $*" >&2
  exit 1
}

warn() {
  echo "mcp-edge-secrets: warning: $*" >&2
}

need_root() {
  [[ $EUID == 0 ]] || die "run it as root: sudo mcp-edge-secrets $*"
}

trim() {
  local value=$1
  value=${value#"${value%%[![:space:]]*}"}
  value=${value%"${value##*[![:space:]]}"}
  printf '%s' "$value"
}

# Yes unless the answer starts with n (default yes) or is not y (default no).
ask() {
  local question=$1 default=$2 answer
  if [[ $default == y ]]; then
    read -r -p "$question [Y/n] " answer || answer=""
    [[ ! $answer =~ ^[Nn] ]]
  else
    read -r -p "$question [y/N] " answer || answer=""
    [[ $answer =~ ^[Yy] ]]
  fi
}

# Writes stdin to $EDGE_SECRETS_DIR/<name>, 0400 root, replacing it at once.
put() {
  local name=$1 tmp
  install -d -m 0700 -o root -g root "$EDGE_SECRETS_DIR"
  tmp=$(mktemp "$EDGE_SECRETS_DIR/.$name.XXXXXX")
  cat > "$tmp"
  chmod 0400 "$tmp"
  chown root:root "$tmp"
  mv -f "$tmp" "$EDGE_SECRETS_DIR/$name"
}

is_client() {
  [[ " $EDGE_CLIENTS " == *" $1 "* ]]
}

unit_active() {
  systemctl is-active --quiet "$1"
}

unit_exists() {
  systemctl cat "$1" > /dev/null 2>&1
}

google() {
  local id secret
  echo "The Google OAuth client for the edge's sign-in (Google Cloud console → Clients)."
  read -r -p "Client ID: " id || true
  id=$(trim "$id")
  [[ -n $id ]] || die "no client ID given; nothing changed"
  read -r -s -p "Client secret (not shown): " secret || true
  echo >&2
  secret=$(trim "$secret")
  [[ -n $secret ]] || die "no client secret given; nothing changed"
  [[ $id == *.apps.googleusercontent.com ]] \
    || warn "a Google client ID ends in .apps.googleusercontent.com; this one does not (saved anyway)"
  [[ $secret == GOCSPX-* ]] \
    || warn "a Google client secret usually starts with GOCSPX-; this one does not (saved anyway)"
  printf '%s\n' "$id" | put google-client-id
  printf '%s\n' "$secret" | put google-client-secret
  echo "Saved google-client-id and google-client-secret in $EDGE_SECRETS_DIR (0400, root)."
  if unit_active keycloak; then
    if ask "Apply it now? (reconciles the realm; nobody is signed out)" y; then
      systemctl restart mcp-edge-realm
      echo "Applied."
    else
      echo "Applies with the next Keycloak start, or: sudo systemctl restart mcp-edge-realm"
    fi
  elif unit_exists keycloak.service; then
    if ask "Keycloak is not running. Start the edge now?" y; then
      systemctl restart mcp-edge-secrets
      systemctl start keycloak
      echo "Started."
    fi
  else
    echo "The edge is off on this machine (mcpEdge = false); it uses these once it is switched on."
  fi
}

age_of() {
  local seconds=$(($(date +%s) - $(stat -c %Y "$1")))
  if ((seconds < 3600)); then
    echo "$((seconds / 60)) min"
  elif ((seconds < 172800)); then
    echo "$((seconds / 3600)) h"
  else
    echo "$((seconds / 86400)) d"
  fi
}

status() {
  local name file client
  local names=(google-client-id google-client-secret)
  for client in $EDGE_CLIENTS; do
    names+=("client-$client-secret")
  done
  names+=("$EDGE_ADMIN_SECRET")
  if [[ -d $EDGE_SECRETS_DIR ]]; then
    printf '%s  %s %s\n' "$EDGE_SECRETS_DIR" "$(stat -c '%a %U' "$EDGE_SECRETS_DIR")" "(directory)"
  else
    echo "$EDGE_SECRETS_DIR: missing (sudo mcp-edge-secrets google creates it)"
  fi
  for name in "${names[@]}"; do
    file=$EDGE_SECRETS_DIR/$name
    if [[ -s $file ]]; then
      printf '  %-24s %s %s, %s old\n' "$name" "$(stat -c '%a' "$file")" "$(stat -c '%U' "$file")" "$(age_of "$file")"
    elif [[ -e $file ]]; then
      printf '  %-24s empty\n' "$name"
    else
      printf '  %-24s missing\n' "$name"
    fi
  done
  for name in keycloak mcp-edge-realm mcp-edge-oauth2-proxy; do
    if unit_exists "$name.service"; then
      printf '  %-24s %s\n' "$name" "$(systemctl is-active "$name" || true)"
    fi
  done
}

client() {
  local name=$1 file
  is_client "$name" || die "no client '$name' (declared: $EDGE_CLIENTS)"
  file=$EDGE_SECRETS_DIR/client-$name-secret
  [[ -s $file ]] || die "$file does not exist yet: the edge writes it on its first start"
  echo "$name's client secret follows: paste it into $name's connector settings, nowhere else." >&2
  cat "$file"
}

rotate() {
  local name=$1
  is_client "$name" || die "no client '$name' (declared: $EDGE_CLIENTS)"
  unit_exists keycloak.service || die "the edge is off on this machine"
  rm -f "$EDGE_SECRETS_DIR/client-$name-secret"
  # Writes a new one; Keycloak restarts with it (sessions survive), and the
  # realm reconcile sets it.
  systemctl restart mcp-edge-secrets
  systemctl restart mcp-edge-realm
  echo "$name has a new client secret; its old one no longer works."
  echo "Paste the new one into $name: sudo mcp-edge-secrets client $name"
}

# Keycloak's admin API, over loopback, as the admin service client. The
# secret and the token travel on curl's stdin, never a command line.
admin_token() {
  local secret
  secret=$(<"$EDGE_SECRETS_DIR/$EDGE_ADMIN_SECRET")
  curl -sSf --data @- "$EDGE_KEYCLOAK/realms/master/protocol/openid-connect/token" \
    <<< "grant_type=client_credentials&client_id=$EDGE_ADMIN_CLIENT&client_secret=$secret" \
    | jq -er .access_token
}

api() {
  local method=$1 path=$2 body=${3:-}
  local args=(-sSf -X "$method" --config -)
  [[ -z $body ]] || args+=(-H 'Content-Type: application/json' --data "$body")
  curl "${args[@]}" "$EDGE_KEYCLOAK/admin/realms/$EDGE_REALM$path" \
    <<< "header = \"Authorization: Bearer $token\""
}

revoke_all() {
  local yes=$1 token realm_id providers provider id
  unit_active keycloak || die "Keycloak is not running; nothing to revoke until it is"
  if [[ $yes != 1 ]] && ! ask "Sign every connector out (Gemini and Claude must sign in again)?" n; then
    die "nothing changed"
  fi
  token=$(admin_token) || die "could not sign in to Keycloak's admin API as $EDGE_ADMIN_CLIENT"
  # Every session, and every refresh token with it.
  api POST /logout-all > /dev/null
  # New signing, encryption and HMAC keys, then the old ones gone: every
  # token they signed fails its signature check.
  realm_id=$(api GET "" | jq -er .id)
  providers=$(api GET "/components?type=org.keycloak.keys.KeyProvider&parent=$realm_id")
  while IFS= read -r provider; do
    id=$(jq -r .id <<< "$provider")
    if [[ $(jq -r .providerId <<< "$provider") != *-generated ]]; then
      warn "key provider $(jq -r .name <<< "$provider") is not generated by Keycloak; left as it is"
      continue
    fi
    api POST /components "$(jq -c --arg suffix "$(date +%s)" '{
      name: ((.name | sub("-[0-9]+$"; "")) + "-" + $suffix),
      providerId, providerType, parentId,
      config: (.config | with_entries(select(.key | IN(
        "priority", "enabled", "active", "algorithm", "keySize", "secretSize",
        "keyUse", "ellipticCurveKey", "eccEllipticCurveKey", "eddsaEllipticCurveKey"))))
    }' <<< "$provider")" > /dev/null
    api DELETE "/components/$id" > /dev/null
  done < <(jq -c '.[]' <<< "$providers")
  # oauth2-proxy caches keys: restarted, it holds only the new ones.
  systemctl restart mcp-edge-oauth2-proxy
  echo "Every session ended and the realm's keys rotated: every connector signs in again."
}

main() {
  case ${1:-} in
    "" | -h | --help | help)
      usage
      ;;
    google)
      [[ $# == 1 ]] || die "google takes no arguments"
      need_root "$@"
      google
      ;;
    status)
      [[ $# == 1 ]] || die "status takes no arguments"
      need_root "$@"
      status
      ;;
    client | rotate)
      [[ $# == 2 ]] || die "usage: mcp-edge-secrets $1 <$(tr ' ' '|' <<< "$EDGE_CLIENTS")>"
      need_root "$@"
      "$1" "$2"
      ;;
    revoke-all)
      [[ $# == 1 || ($# == 2 && $2 == --yes) ]] || die "usage: mcp-edge-secrets revoke-all [--yes]"
      need_root "$@"
      revoke_all "$([[ ${2:-} == --yes ]] && echo 1 || echo 0)"
      ;;
    *)
      die "unknown command: $1 (mcp-edge-secrets -h)"
      ;;
  esac
}

main "$@"
