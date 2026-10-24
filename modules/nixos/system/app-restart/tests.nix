{ pkgs }:

# Builds the my.services restart scripts (./scripts.nix) exactly as the
# module does, but against a fake systemctl, bb and sleep that act on a
# state directory ($FAKE), and runs ./tests.sh over them: the waiter's
# restart decisions, restart-app and its --status report, the start record,
# the companion condition, and the npm pin.
let
  fakeTools = pkgs.runCommand "app-restart-fake-tools" { } ''
    mkdir -p "$out/bin"
    # systemctl: units in $FAKE/active are active; `show -P <Prop> <unit>`
    # reads $FAKE/<Prop>.<unit>; actions are logged to $FAKE/log, and a
    # try-restart fails once while $FAKE/fail-restart exists.
    cat >"$out/bin/systemctl" <<'EOF'
    #!${pkgs.runtimeShell}
    case "$1" in
      is-active) [ "$2" = -q ] && shift; grep -qxF -- "$2" "$FAKE/active" 2>/dev/null ;;
      show) cat "$FAKE/$3.$4" 2>/dev/null || true ;;
      try-restart)
        shift
        echo "try-restart $*" >>"$FAKE/log"
        if [ -e "$FAKE/fail-restart" ]; then rm -f "$FAKE/fail-restart"; exit 1; fi ;;
      start) shift; echo "start $*" >>"$FAKE/log" ;;
      *) echo "fake systemctl: unexpected $*" >&2; exit 9 ;;
    esac
    EOF
    # bb: `bb idle` passes while $FAKE/idle exists; $FAKE/idle-once makes the
    # next check pass and the one after fail.
    cat >"$out/bin/bb" <<'EOF'
    #!${pkgs.runtimeShell}
    if [ -e "$FAKE/idle-once" ]; then
      rm -f "$FAKE/idle-once"
      : >"$FAKE/busy-next"
      exit 0
    fi
    if [ -e "$FAKE/busy-next" ]; then rm -f "$FAKE/busy-next"; exit 1; fi
    [ -e "$FAKE/idle" ]
    EOF
    # sleep: one step of the scenario; runs $FAKE/step.<n> if present.
    cat >"$out/bin/sleep" <<'EOF'
    #!${pkgs.runtimeShell}
    n=$(( $(cat "$FAKE/steps" 2>/dev/null || echo 0) + 1 ))
    echo "$n" >"$FAKE/steps"
    echo "sleep $1" >>"$FAKE/log"
    if [ -e "$FAKE/step.$n" ]; then ${pkgs.runtimeShell} "$FAKE/step.$n"; fi
    [ "$n" -lt 20 ] || { echo "fake sleep: too many steps" >&2; exit 1; }
    EOF
    chmod +x "$out/bin/"*
  '';
  scripts = import ./scripts.nix {
    inherit pkgs;
    systemctl = fakeTools;
  };
  # An app `demo` that waits for idle: its own unit has no idleCheck, its
  # `worker` companion has one.
  waiterArgs = {
    name = "demo";
    units = [
      {
        unit = "app-demo.service";
        key = "demo";
        checked = false;
      }
      {
        unit = "app-demo-worker.service";
        key = "demo-worker";
        checked = true;
      }
    ];
    idleChecks = [ "bb idle" ];
    path = "${fakeTools}/bin";
  };
  table = {
    "app-demo.service" = {
      key = "demo";
      checked = false;
      waiter = "app-demo-restart-when-idle.service";
    };
    "app-demo-worker.service" = {
      key = "demo-worker";
      checked = true;
      waiter = "app-demo-restart-when-idle.service";
      main = "app-demo.service";
    };
    "app-plain.service" = { };
  };
in
pkgs.runCommand "app-restart-check"
  {
    nativeBuildInputs = [
      pkgs.bash
      pkgs.coreutils
      pkgs.gnugrep
      pkgs.jq
    ];
  }
  ''
    export PATH="${fakeTools}/bin:$PATH"
    bash ${./tests.sh} \
      ${scripts.waiter waiterArgs} \
      ${scripts.waiter (waiterArgs // { giveUpSeconds = 0; })} \
      ${scripts.restartApp table}/bin/restart-app \
      ${scripts.npmPin}/bin/app-npm-pin \
      ${scripts.recordStart} \
      ${scripts.companionCondition}
    touch "$out"
  ''
