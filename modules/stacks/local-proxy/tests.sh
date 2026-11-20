# shellcheck shell=bash
# Asserts the local proxy's promises against the real CA script and Caddy
# configuration (./tests.nix sets CADDYFILE, CA_NAME, PORT, BACKEND_PORT and
# BACKEND). Each step says what it proves; any failure fails the build.
set -euo pipefail

STATE=$PWD/state
export STATE HOME=$PWD/home XDG_CONFIG_HOME=$PWD/config XDG_DATA_HOME=$PWD/data
ORIGIN=https://app.localhost:$PORT
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}
mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
# A certificate's notBefore and notAfter, in seconds since the epoch.
begins() { date -d "$(openssl x509 -in "$1" -noout -startdate | cut -d= -f2)" +%s; }
ends() { date -d "$(openssl x509 -in "$1" -noout -enddate | cut -d= -f2)" +%s; }
fingerprint() { openssl x509 -in "$1" -noout -fingerprint -sha256; }
day=$((24 * 3600))
# macOS's own verifier exists only on macOS; elsewhere (the Linux check)
# openssl alone decides.
darwin=false
[ "$(uname -s)" != Darwin ] || darwin=true

echo "== the CA is made once, its key root-only, constrained to localhost names and no IP"
local-proxy-ca "$STATE" "$CA_NAME"
[ "$(mode "$STATE/ca/private")" = 700 ] || fail "private dir is $(mode "$STATE/ca/private")"
[ "$(mode "$STATE/ca/private/root.key")" = 600 ] || fail "key is $(mode "$STATE/ca/private/root.key")"
[ "$(mode "$STATE/ca/root.crt")" = 644 ] || fail "certificate is $(mode "$STATE/ca/root.crt")"
openssl x509 -in "$STATE/ca/root.crt" -noout -ext nameConstraints,basicConstraints >constraints
grep -q "Name Constraints: critical" constraints || fail "name constraint is not critical"
grep -q "Permitted:" constraints || fail "no permitted subtree"
grep -q "DNS:localhost" constraints || fail "not limited to localhost"
grep -qF "IP:0.0.0.0/0.0.0.0" constraints || fail "IPv4 addresses are not excluded"
grep -qF "IP:0:0:0:0:0:0:0:0/0:0:0:0:0:0:0:0" constraints || fail "IPv6 addresses are not excluded"
grep -q "CA:TRUE" constraints || fail "not a CA"
first=$(openssl x509 -in "$STATE/ca/root.crt" -noout -fingerprint -sha256)
[ -z "$(local-proxy-ca "$STATE" "$CA_NAME")" ] || fail "a second run did more than check"
[ "$first" = "$(openssl x509 -in "$STATE/ca/root.crt" -noout -fingerprint -sha256)" ] ||
  fail "a second run replaced a sound CA"

echo "== Caddy listens on loopback only, with no admin endpoint and no HTTP listener"
caddy adapt --config "$CADDYFILE" --adapter caddyfile >adapted.json 2>/dev/null
[ "$(jq -c '[.apps.http.servers[].listen[]] | sort' adapted.json)" = \
  "[\"127.0.0.1:$PORT\",\"[::1]:$PORT\"]" ] || fail "listeners: $(jq -c '[.apps.http.servers[].listen[]]' adapted.json)"
[ "$(jq '.admin.disabled' adapted.json)" = true ] || fail "the admin endpoint is on"
[ "$(jq '[.apps.http.servers[].automatic_https.disable_redirects] | all' adapted.json)" = true ] ||
  fail "an HTTP redirect listener is on"
[ "$(jq '.apps.tls.automation.policies // [] | map(.issuers // [] | map(.module)) | flatten | unique' adapted.json)" = '[
  "internal"
]' ] || fail "a site is not signed by the internal CA"

echo "== site certificates last 825 days; Caddy renews the intermediate only with 5% left"
[ "$(jq -c '[.apps.tls.automation.policies[].issuers[].lifetime] | unique' adapted.json)" = \
  "[$((825 * day))000000000]" ] ||
  fail "site certificate lifetimes: $(jq -c '[.apps.tls.automation.policies[].issuers[].lifetime]' adapted.json)"
[ "$(jq '.apps.pki.certificate_authorities.local.renewal_window_ratio' adapted.json)" = 0.05 ] ||
  fail "the intermediate renews at $(jq '.apps.pki.certificate_authorities.local.renewal_window_ratio' adapted.json)"

python3 "$BACKEND" "$BACKEND_PORT" &
backend_pid=$!
trap 'kill "${pids[@]}" "$backend_pid" 2>/dev/null || true' EXIT

# Runs the proxy (a command line) until it serves the site, or fails.
start() {
  "$@" >>caddy.log 2>&1 &
  pids=($!)
  for _ in $(seq 1 100); do
    curl -sf -o /dev/null --cacert "$STATE/ca/root.crt" "$ORIGIN/echo" && return
    sleep 0.2
  done
  cat caddy.log >&2
  fail "the proxy did not serve $ORIGIN"
}
stop() {
  kill "${pids[@]}"
  wait "${pids[@]}" 2>/dev/null || true
  pids=()
}
# The chain the proxy serves: served-0.pem is the site's certificate,
# served-1.pem its intermediate.
served() {
  rm -f served-*.pem
  openssl s_client -connect "127.0.0.1:$PORT" -servername app.localhost -showcerts </dev/null 2>/dev/null |
    awk '/-----BEGIN CERTIFICATE-----/ { f = "served-" n++ ".pem" } f { print > f } /-----END CERTIFICATE-----/ { f = "" }' ||
    true
  [ -s served-0.pem ] && [ -s served-1.pem ] || fail "the proxy served no certificate chain"
}
caddy=(caddy run --config "$CADDYFILE" --adapter caddyfile)
authority=$STATE/caddy/pki/authorities/local

echo "== a site certificate cannot outlive its intermediate"
# Caddy run alone with a 7-day intermediate: the state this stack left
# before its lifetimes grew (12-hour sites under a 7-day intermediate).
LOCAL_PROXY_INTERMEDIATE_LIFETIME=7d start "${caddy[@]}"
served
[ $(($(ends "$authority/intermediate.crt") - $(begins "$authority/intermediate.crt"))) = $((7 * day)) ] ||
  fail "the old-style intermediate does not last 7 days"
[ "$(ends served-0.pem)" -le "$(ends "$authority/intermediate.crt")" ] ||
  fail "a site certificate outlives its intermediate"
short=$(fingerprint "$authority/intermediate.crt")
stop

echo "== an intermediate that ends before the root is retired, with the site certificates it signed"
start local-proxy-ca "$STATE" "$CA_NAME" "${caddy[@]}"
grep -q "retiring the intermediate" caddy.log || fail "the short intermediate was not retired"
[ "$short" != "$(fingerprint "$authority/intermediate.crt")" ] || fail "the short intermediate was kept"
served
[ "$(fingerprint served-1.pem)" = "$(fingerprint "$authority/intermediate.crt")" ] ||
  fail "the site is served under another intermediate"

echo "== the intermediate lasts as long as the root, less a day; the site certificate 825 days"
gap=$(($(ends "$STATE/ca/root.crt") - $(ends "$authority/intermediate.crt")))
[ "$gap" -ge $((day - 300)) ] && [ "$gap" -le $((day + 300)) ] ||
  fail "the intermediate ends ${gap}s before the root, not a day"
[ $(($(ends served-0.pem) - $(begins served-0.pem))) = $((825 * day)) ] ||
  fail "the site certificate lasts $(($(ends served-0.pem) - $(begins served-0.pem)))s, not 825 days"
openssl verify -CAfile "$STATE/ca/root.crt" -untrusted served-1.pem served-0.pem >/dev/null ||
  fail "openssl does not accept the served chain"
# The ssl policy applies macOS's cap on a TLS server certificate's
# lifetime (825 days), which holds under a private root too.
if $darwin && ! /usr/bin/security verify-cert -c served-0.pem -c served-1.pem \
  -r "$STATE/ca/root.crt" -p ssl -s app.localhost -L -n >/dev/null; then
  fail "macOS does not accept the served chain"
fi

echo "== a restart keeps a sound intermediate and the site certificate"
site=$(fingerprint served-0.pem)
long=$(fingerprint "$authority/intermediate.crt")
stop
start local-proxy-ca "$STATE" "$CA_NAME" "${caddy[@]}"
served
[ "$long" = "$(fingerprint "$authority/intermediate.crt")" ] || fail "a sound intermediate was replaced"
[ "$site" = "$(fingerprint served-0.pem)" ] || fail "a sound site certificate was replaced"

get() { curl -sS --fail --cacert "$STATE/ca/root.crt" "$@"; }

echo "== the site is served over HTTPS on 127.0.0.1 and [::1], chained to the CA"
for address in 127.0.0.1 '[::1]'; do
  get --resolve "app.localhost:$PORT:$address" -o /dev/null "$ORIGIN/echo" ||
    fail "not served at $address"
done

echo "== Host and Origin reach the app untouched (each app keeps its own guard)"
get -H "Origin: https://elsewhere.example" "$ORIGIN/echo" >echo.json
[ "$(jq -r .host echo.json)" = "app.localhost:$PORT" ] || fail "Host became $(jq -r .host echo.json)"
[ "$(jq -r .origin echo.json)" = "https://elsewhere.example" ] ||
  fail "Origin became $(jq -r .origin echo.json)"

echo "== a WebSocket upgrade is passed through"
status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 --http1.1 --cacert "$STATE/ca/root.crt" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$ORIGIN/ws" || true)
[ "$status" = 101 ] || fail "upgrade answered $status"

echo "== server-sent events arrive as they are sent, not buffered"
# The stream lasts over two seconds; a buffering proxy would send nothing
# before it ends.
curl -sN --max-time 1.5 --cacert "$STATE/ca/root.crt" "$ORIGIN/sse" >sse.out || true
[ "$(head -n 1 sse.out)" = "data: 0" ] || fail "no event within 1.5s: '$(cat sse.out)'"

echo "== an undeclared name gets no certificate"
if curl -s -o /dev/null --cacert "$STATE/ca/root.crt" \
  --resolve "other.localhost:$PORT:127.0.0.1" "https://other.localhost:$PORT/"; then
  fail "other.localhost was served"
fi

echo "== the CA cannot vouch for a DNS name outside localhost, nor for any IP address"
for san in DNS:app.localhost DNS:example.com DNS:localhost.example.com \
  IP:127.0.0.1 IP:93.184.216.34 IP:::1 IP:2606:2800:220:1::1; do
  leaf=forged-$(tr ':.' '__' <<<"$san")
  openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj "/" \
    -keyout "$leaf.key" -out "$leaf.csr" 2>/dev/null
  printf 'subjectAltName=critical,%s\nextendedKeyUsage=serverAuth\n' "$san" >"$leaf.ext"
  openssl x509 -req -in "$leaf.csr" -CA "$authority/intermediate.crt" \
    -CAkey "$authority/intermediate.key" -CAcreateserial -days 1 -extfile "$leaf.ext" \
    -out "$leaf.crt" 2>/dev/null
  if openssl verify -CAfile "$STATE/ca/root.crt" -untrusted "$authority/intermediate.crt" \
    "$leaf.crt" >/dev/null 2>&1; then
    verdict=valid
  else
    verdict=refused
  fi
  # macOS's own verifier, with the root as the anchor, must agree: a
  # constraint openssl enforces and macOS ignores would not hold in a browser.
  if ! $darwin; then
    native=$verdict
  elif /usr/bin/security verify-cert -c "$leaf.crt" -c "$authority/intermediate.crt" \
    -r "$STATE/ca/root.crt" -p basic -L -n >/dev/null 2>&1; then
    native=valid
  else
    native=refused
  fi
  case $san in
    DNS:*.localhost) expected=valid ;;
    *) expected=refused ;;
  esac
  [ "$verdict" = "$expected" ] || fail "openssl: $san was $verdict"
  [ "$native" = "$expected" ] || fail "macOS: $san was $native"
done

echo "== a broken CA is replaced, and Caddy's certificates under it are dropped"
stop
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$STATE/ca/private/root.key"
local-proxy-ca "$STATE" "$CA_NAME" >/dev/null
[ "$first" != "$(openssl x509 -in "$STATE/ca/root.crt" -noout -fingerprint -sha256)" ] ||
  fail "a mismatched key kept the old certificate"
[ ! -e "$STATE/caddy/pki" ] || fail "the old intermediate was kept"
[ ! -e "$STATE/caddy/certificates/local" ] || fail "the old site certificates were kept"
[ "$(mode "$STATE/ca/private/root.key")" = 600 ] || fail "the new key is not root-only"

echo "== a root without the IP exclusions is replaced"
cat >weak.cnf <<'CNF'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = weak
[root]
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign, cRLSign
nameConstraints = critical, permitted;DNS:localhost
CNF
openssl req -x509 -new -key "$STATE/ca/private/root.key" -sha256 -days 3650 \
  -config weak.cnf -extensions root -out "$STATE/ca/root.crt"
weak=$(openssl x509 -in "$STATE/ca/root.crt" -noout -fingerprint -sha256)
local-proxy-ca "$STATE" "$CA_NAME" >/dev/null
[ "$weak" != "$(openssl x509 -in "$STATE/ca/root.crt" -noout -fingerprint -sha256)" ] ||
  fail "a root without the IP exclusions was kept"

echo "local proxy: all checks passed"
