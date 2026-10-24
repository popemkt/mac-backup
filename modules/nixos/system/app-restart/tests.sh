#!/usr/bin/env bash
# tests.sh <waiter> <waiter giving up at once> <restart-app> <app-npm-pin>
#          <app-restart-record> <app-companion-condition>
# Run by ./tests.nix against the fake systemctl, bb and sleep on PATH.
set -euo pipefail
waiter="$1" waiter_give_up="$2" restart_app="$3" npm_pin="$4" record="$5" condition="$6"

failures=0
fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}
expect_log() { # expect_log <scenario> <exact log of try-restart/start lines>
  local got
  got="$(grep -E '^(try-restart|start) ' "$FAKE/log" || true)"
  [ "$got" = "$2" ] || fail "$1: expected actions [$2], got [$got]"
}

# A fresh world: app-demo (no idleCheck) and app-demo-worker (idleCheck).
DEMO_HASH=demo-new WORKER_HASH=worker-new
fresh() {
  root="$(mktemp -d)"
  export FAKE="$root/fake" APP_RESTART_STATE="$root/run" APP_RESTART_ETC="$root/etc" APP_PINS="$root/pins"
  mkdir -p "$FAKE" "$APP_RESTART_STATE/demo" "$APP_RESTART_STATE/demo-worker" "$APP_RESTART_ETC"
  echo "$DEMO_HASH" >"$APP_RESTART_ETC/demo.definition"
  echo "$WORKER_HASH" >"$APP_RESTART_ETC/demo-worker.definition"
  # Loaded definitions: the new ones (daemon-reload done).
  echo "-record demo $DEMO_HASH free worker" >"$FAKE/ExecStartPost.app-demo.service"
  echo "-record demo-worker $WORKER_HASH gated" >"$FAKE/ExecStartPost.app-demo-worker.service"
  echo loaded >"$FAKE/LoadState.app-demo-restart-when-idle.service"
  : >"$FAKE/log"
}
both_running_current() {
  printf 'app-demo.service\napp-demo-worker.service\n' >"$FAKE/active"
  "$record" demo "$DEMO_HASH" free worker
  "$record" demo-worker "$WORKER_HASH" gated
}
step() { # step <n> <shell command run at the n-th sleep>
  printf '%s\n' "$2" >"$FAKE/step.$1"
}

echo "== waiter: nothing pending"
fresh
both_running_current
"$waiter" >/dev/null
expect_log "nothing pending" ""

echo "== waiter: the app's own unit changed (free): restarts at once, alone"
fresh
both_running_current
"$record" demo demo-old free worker
"$waiter" >/dev/null
expect_log "free change" "try-restart app-demo.service"

echo "== waiter: waits for daemon-reload before restarting"
fresh
both_running_current
"$record" demo demo-old free worker
echo "-record demo demo-old free worker" >"$FAKE/ExecStartPost.app-demo.service"
step 1 "echo '-record demo $DEMO_HASH free worker' >'$FAKE/ExecStartPost.app-demo.service'"
"$waiter" >/dev/null
expect_log "reload first" "try-restart app-demo.service"
grep -qx 'sleep 5' "$FAKE/log" || fail "reload first: did not wait for daemon-reload"

echo "== waiter: the companion changed (gated): waits for idle, restarts it alone"
fresh
both_running_current
"$record" demo-worker worker-old gated
step 2 "touch '$FAKE/idle'"
"$waiter" >/dev/null
expect_log "gated change" "try-restart app-demo-worker.service"
[ "$(grep -c '^sleep 30' "$FAKE/log")" = 2 ] || fail "gated change: expected two busy waits"

echo "== waiter: an upgrade requests both: they restart together once idle"
fresh
both_running_current
: >"$APP_RESTART_STATE/demo/requested"
: >"$APP_RESTART_STATE/demo-worker/requested"
step 1 "touch '$FAKE/idle'"
"$waiter" >/dev/null
expect_log "upgrade" "try-restart app-demo.service app-demo-worker.service"

echo "== waiter: a running process started under an idleCheck waits, though its new definition has none (the cutover)"
fresh
echo app-demo.service >"$FAKE/active"
echo old-combined >"$APP_RESTART_STATE/demo/started" # no free record, no companions
step 1 "touch '$FAKE/idle'"
"$waiter" >/dev/null
expect_log "cutover" "try-restart app-demo.service"
grep -qx 'sleep 30' "$FAKE/log" || fail "cutover: restarted without waiting for idle"

echo "== waiter: work that starts during the check defers the restart"
fresh
both_running_current
: >"$APP_RESTART_STATE/demo-worker/requested"
: >"$FAKE/idle-once"
step 1 "touch '$FAKE/idle'"
"$waiter" >/dev/null
expect_log "recheck" "try-restart app-demo-worker.service"
grep -qx 'sleep 30' "$FAKE/log" || fail "recheck: restarted although the second check was busy"

echo "== waiter: a failed try-restart is retried"
fresh
both_running_current
"$record" demo demo-old free worker
: >"$FAKE/fail-restart"
"$waiter" >/dev/null 2>&1
expect_log "retry" "try-restart app-demo.service
try-restart app-demo.service"

echo "== waiter: gives up loudly"
fresh
both_running_current
"$record" demo-worker worker-old gated
if "$waiter_give_up" >/dev/null 2>"$root/err"; then fail "give up: exited 0"; fi
grep -q 'giving up' "$root/err" || fail "give up: no message"

echo "== restart-app"
fresh
both_running_current
out="$("$restart_app" app-plain.service)"
expect_log "plain" "try-restart app-plain.service"
: >"$FAKE/log"
out="$("$restart_app" app-demo-worker.service)"
[ -e "$APP_RESTART_STATE/demo-worker/requested" ] || fail "restart-app: no request recorded"
grep -q 'restart pending until idle' <<<"$out" || fail "restart-app: gated unit message: $out"
expect_log "restart-app gated" "start --no-block app-demo-restart-when-idle.service"
out="$("$restart_app" app-demo.service)"
grep -q 'restarting once its new definition is loaded' <<<"$out" || fail "restart-app: free unit message: $out"
if "$restart_app" app-nope.service 2>/dev/null; then fail "restart-app: accepted an unknown unit"; fi

echo "== restart-app --status"
fresh
both_running_current
if ! "$restart_app" --status >"$root/status"; then fail "status: reported problems when clean: $(cat "$root/status")"; fi
[ ! -s "$root/status" ] || fail "status: not silent when clean"
: >"$APP_RESTART_STATE/demo-worker/requested"
echo failed >"$FAKE/ActiveState.app-demo-restart-when-idle.service"
"$restart_app" --status >"$root/status" && fail "status: exit 0 with a pending restart"
grep -q 'app-demo-worker.service: restart pending (waits for idle' "$root/status" || fail "status: pending restart missing: $(cat "$root/status")"
grep -q 'gave up' "$root/status" || fail "status: failed waiter missing"
echo app-demo.service >"$FAKE/active"
"$restart_app" --status >"$root/status" || true
grep -q 'app-demo-worker.service: not running beside app-demo.service' "$root/status" || fail "status: skipped companion missing: $(cat "$root/status")"

echo "== record and companion condition"
fresh
echo old-combined >"$APP_RESTART_STATE/demo/started"
if "$condition" demo worker 2>"$root/err"; then fail "condition: passed beside a process from before the companion"; fi
grep -q '^<4>' "$root/err" || fail "condition: no journal warning"
: >"$APP_RESTART_STATE/demo/requested"
"$record" demo "$DEMO_HASH" free worker
[ ! -e "$APP_RESTART_STATE/demo/requested" ] || fail "record: request not cleared"
[ -e "$APP_RESTART_STATE/demo/free" ] || fail "record: no free record"
"$condition" demo worker || fail "condition: failed beside a process started with it"
"$record" demo-worker "$WORKER_HASH" gated
[ ! -e "$APP_RESTART_STATE/demo-worker/free" ] || fail "record: free record for a gated unit"

echo "== app-npm-pin"
fresh
prefix="$root/prefix"
install() { # install <version>: what `npm install -g` leaves
  rm -rf "$prefix/lib/node_modules/@demo/app"
  mkdir -p "$prefix/lib/node_modules/@demo/app/dist"
  printf '{"name":"@demo/app","version":"%s","bin":{"demo-server":"dist/server.js","demo-worker":"dist/worker.js"}}\n' "$1" \
    >"$prefix/lib/node_modules/@demo/app/package.json"
  echo "echo server $1" >"$prefix/lib/node_modules/@demo/app/dist/server.js"
  echo "echo worker $1" >"$prefix/lib/node_modules/@demo/app/dist/worker.js"
}
install 1.0.0
bin="$("$npm_pin" demo @demo/app "$prefix" 0 2>/dev/null)"
[ "$bin" = "$APP_PINS/demo/1.0.0/bin" ] || fail "pin: first pin is $bin"
[ "$(cat "$bin/demo-server")" = "echo server 1.0.0" ] || fail "pin: bin link does not reach the copy"
install 2.0.0
echo app-demo-worker.service >"$FAKE/active"
bin="$("$npm_pin" demo @demo/app "$prefix" 1 app-demo-worker.service 2>/dev/null)"
[ "$bin" = "$APP_PINS/demo/1.0.0/bin" ] || fail "pin: moved while a sibling runs: $bin"
[ "$(cat "$bin/demo-server")" = "echo server 1.0.0" ] || fail "pin: the copy changed under the upgrade"
bin="$("$npm_pin" demo @demo/app "$prefix" 0 2>/dev/null)"
[ "$bin" = "$APP_PINS/demo/1.0.0/bin" ] || fail "pin: a companion moved the pin: $bin"
: >"$FAKE/active"
bin="$("$npm_pin" demo @demo/app "$prefix" 1 app-demo-worker.service 2>/dev/null)"
[ "$bin" = "$APP_PINS/demo/2.0.0/bin" ] || fail "pin: did not move with no sibling running: $bin"
install 3.0.0
bin="$("$npm_pin" demo @demo/app "$prefix" 1 app-demo-worker.service 2>/dev/null)"
[ "$bin" = "$APP_PINS/demo/3.0.0/bin" ] || fail "pin: did not move to 3.0.0: $bin"
[ -d "$APP_PINS/demo/2.0.0" ] || fail "pin: dropped the previous copy"
[ ! -e "$APP_PINS/demo/1.0.0" ] || fail "pin: kept a copy older than the previous one"
mkdir -p "$prefix/lib/node_modules/single"
echo '{"name":"single","version":"0.1.0","bin":"cli.js"}' >"$prefix/lib/node_modules/single/package.json"
bin="$("$npm_pin" single single "$prefix" 1 2>/dev/null)"
[ -L "$bin/single" ] || fail "pin: a string bin was not linked under the package's name"

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)" >&2
  exit 1
fi
echo "all app-restart tests passed"
