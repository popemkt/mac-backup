{ pkgs, systemctl }:

# The scripts behind my.services restarts (../services.nix explains when each
# runs). Kept apart from the module so a flake check builds the very same
# scripts against a fake systemctl and runs them (./tests.nix). Each reads
# its directories from the environment, defaulting to the real ones:
#   APP_RESTART_STATE  /run/app-restart      a unit's started/free/requested/companions
#   APP_RESTART_ETC    /etc/app-restart      a unit's current definition hash
#   APP_PINS           /var/lib/app-pins     an npm app's pinned package copies
# `systemctl` is a package whose bin/ has systemctl.
let
  inherit (pkgs) lib;
  stateDir = ''state="''${APP_RESTART_STATE:-/run/app-restart}"'';
  etcDir = ''etc="''${APP_RESTART_ETC:-/etc/app-restart}"'';
  pinsDir = ''pins="''${APP_PINS:-/var/lib/app-pins}"'';
  # Is the unit's restart pending, and would it wait for idle? Shared by the
  # waiter, restart-app and the status report. Needs $state and $etc.
  pendingFunctions = ''
    # restart_pending <key>: the unit was asked to restart, or runs an old definition.
    restart_pending() {
      [ -e "$state/$1/requested" ] \
        || [ "$(cat "$state/$1/started" 2>/dev/null)" != "$(cat "$etc/$1.definition" 2>/dev/null)" ]
    }
    # restart_gated <key> <1 when its definition has an idleCheck>: its restart waits
    # for idle, because its new definition says so or its running process
    # started under an idleCheck (no `free` record).
    restart_gated() {
      [ "$2" = 1 ] || [ ! -e "$state/$1/free" ]
    }
  '';
in
rec {
  # app-restart-record <key> <hash> <gated|free> <companion>...: run by each
  # unit once started: the definition it started with, whether it started
  # under an idleCheck, and the companions it started with. The start also
  # fulfils any requested restart.
  recordStart = pkgs.writeShellScript "app-restart-record" ''
    ${stateDir}
    dir="$state/$1"
    printf '%s\n' "$2" >"$dir/started"
    if [ "$3" = free ]; then : >"$dir/free"; else rm -f "$dir/free"; fi
    shift 3
    printf '%s\n' "$@" >"$dir/companions"
    rm -f "$dir/requested"
  '';

  # app-companion-condition <app> <companion>: a companion's ExecCondition.
  # It starts only beside an app process that was started with it declared;
  # a process from before may still do the companion's work itself.
  companionCondition = pkgs.writeShellScript "app-companion-condition" ''
    ${stateDir}
    if ! ${pkgs.gnugrep}/bin/grep -qxF -- "$2" "$state/$1/companions" 2>/dev/null; then
      # <4>: a warning in the journal.
      echo "<4>app-$1 still runs a process from before its $2 companion; $2 starts with app-$1's next restart (restart-app --status lists it)" >&2
      exit 1
    fi
  '';

  # app-npm-pin <app> <package> <npm prefix> <repin: 1|0> <sibling unit>...
  # Prints the bin directory of the copy of <package> the unit runs. Every
  # unit of an app runs one copy, under $APP_PINS/<app>, taken from the npm
  # prefix: an upgrade rewrites the installed package in place, and a unit
  # that starts on its own (a crash, a manual restart) must not load a
  # version its running siblings do not speak. The copy moves to the
  # installed version only when an app's own unit (repin 1) starts with none
  # of its siblings running, so only a restart of the whole app (an idle
  # upgrade, a boot) moves it. The first start takes a copy whatever repin.
  npmPin = pkgs.writeShellApplication {
    name = "app-npm-pin";
    runtimeInputs = [
      pkgs.coreutils
      pkgs.flock
      pkgs.jq
      systemctl
    ];
    text = ''
      ${pinsDir}
      [ "$#" -ge 4 ] || { echo "usage: app-npm-pin <app> <package> <npm prefix> <1|0> <sibling unit>..." >&2; exit 2; }
      app="$1" package="$2" prefix="$3" repin="$4"
      shift 4
      dir="$pins/$app"
      mkdir -p "$dir"
      exec 9>"$dir/.lock"
      flock 9
      current="$(cat "$dir/current" 2>/dev/null || true)"
      if [ -n "$current" ] && [ -d "$current/bin" ]; then
        if [ "$repin" = 1 ]; then
          for sibling in "$@"; do
            if systemctl is-active -q "$sibling"; then
              echo "app-npm-pin: $sibling runs, so $app stays on $(basename "$current")" >&2
              repin=0
              break
            fi
          done
        fi
        if [ "$repin" != 1 ]; then
          echo "$current/bin"
          exit 0
        fi
      fi
      source="$prefix/lib/node_modules/$package"
      version="$(jq -r .version "$source/package.json")"
      target="$dir/$version"
      if [ ! -d "$target/bin" ]; then
        partial="$dir/.partial"
        rm -rf "$partial"
        mkdir -p "$partial/bin" "$(dirname "$partial/lib/node_modules/$package")"
        cp -a "$source" "$partial/lib/node_modules/$package"
        copied="$(jq -r .version "$partial/lib/node_modules/$package/package.json")"
        [ "$copied" = "$version" ] || { echo "app-npm-pin: $package changed from $version to $copied while copying; retry" >&2; exit 1; }
        jq -r --arg name "''${package##*/}" '
          (if (.bin | type) == "string" then [[$name, .bin]]
           else [.bin // {} | to_entries[] | [.key, .value]] end)[] | @tsv
        ' "$partial/lib/node_modules/$package/package.json" | while IFS=$'\t' read -r bin path; do
          ln -s "../lib/node_modules/$package/$path" "$partial/bin/$bin"
        done
        rm -rf "$target"
        mv "$partial" "$target"
      fi
      if [ "$current" != "$target" ]; then
        [ -z "$current" ] || printf '%s\n' "$current" >"$dir/previous"
        printf '%s\n' "$target" >"$dir/current.new"
        mv "$dir/current.new" "$dir/current"
        echo "app-npm-pin: $app now runs $package $version" >&2
      fi
      # Keep the pinned copy and the one before it.
      keep="$(cat "$dir/previous" 2>/dev/null || true)"
      for old in "$dir"/*/; do
        old="''${old%/}"
        [ "$old" = "$target" ] || [ "$old" = "$keep" ] || rm -rf "$old"
      done
      echo "$target/bin"
    '';
  };

  # restart-app <unit> | --status. `table` maps each my.services unit to what
  # restart-app knows of it: for a unit of an app that waits for idle, its
  # key, whether its definition has an idleCheck, and the app's waiter; for
  # a companion, its app's unit.
  restartApp =
    table:
    pkgs.writeShellApplication {
      name = "restart-app";
      runtimeInputs = [
        pkgs.jq
        pkgs.coreutils
        systemctl
      ];
      text = ''
        ${stateDir}
        ${etcDir}
        ${pendingFunctions}
        units=${pkgs.writeText "app-restarts.json" (builtins.toJSON table)}
        if [ "''${1:-}" = --status ]; then
          # Every restart still pending, every companion not running beside
          # its running app, and every waiter that gave up. Silent when none.
          problems=0
          while IFS=$'\t' read -r unit key checked waiter main; do
            if [ -n "$key" ] && systemctl is-active -q "$unit" && restart_pending "$key"; then
              if restart_gated "$key" "$checked"; then how="waits for idle"; else how="restarts once loaded"; fi
              echo "$unit: restart pending ($how; journalctl -u $waiter)"
              problems=1
            fi
            if [ -n "$main" ] && systemctl is-active -q "$main" && ! systemctl is-active -q "$unit"; then
              echo "$unit: not running beside $main (systemctl status $unit)"
              problems=1
            fi
          done < <(jq -r 'to_entries[] | [.key, .value.key // "", (if .value.checked then "1" else "0" end), .value.waiter // "", .value.main // ""] | @tsv' "$units")
          while read -r waiter; do
            if [ "$(systemctl show -P ActiveState "$waiter")" = failed ]; then
              echo "$waiter: gave up waiting (journalctl -u $waiter); it retries hourly"
              problems=1
            fi
          done < <(jq -r '[.[] | .waiter // empty] | unique[]' "$units")
          exit "$problems"
        fi
        [ "$#" -eq 1 ] || { echo "usage: restart-app app-<name>.service | --status" >&2; exit 2; }
        unit="$1"
        entry="$(jq -c --arg u "$unit" '.[$u] // empty' "$units")"
        [ -n "$entry" ] || { echo "restart-app: $unit is not a my.services app" >&2; exit 2; }
        key="$(jq -r '.key // empty' <<<"$entry")"
        if [ -z "$key" ]; then
          echo "Restarting $unit"
          systemctl try-restart "$unit" \
            || { echo "warning: could not restart $unit; run: sudo systemctl restart $unit" >&2; exit 1; }
          exit 0
        fi
        waiter="$(jq -r '.waiter' <<<"$entry")"
        checked="$(jq -r 'if .checked then "1" else "0" end' <<<"$entry")"
        requested="$state/$key/requested"
        [ -e "$requested" ] || : >"$requested" \
          || echo "warning: could not write $requested" >&2
        if restart_gated "$key" "$checked"; then
          echo "$unit: restart pending until idle (or: sudo systemctl restart $unit)"
        else
          echo "$unit: restarting once its new definition is loaded ($waiter)"
        fi
        # A waiter this very switch adds is not loaded before its daemon-reload;
        # the switch starts it then, since multi-user.target wants it.
        if [ "$(systemctl show -P LoadState "$waiter")" = loaded ]; then
          systemctl start --no-block "$waiter" \
            || echo "warning: could not start $waiter; run: sudo systemctl start $waiter" >&2
        fi
      '';
    };

  # restart-apps-updated-by <installer> <tool>...: restart every unit of the
  # caller's my.services apps that declared `updatedBy.<installer> = <tool>`.
  # `updated` lists { installer, tool, owner, unit }.
  restartAppsUpdatedBy =
    restartAppPackage: updated:
    pkgs.writeShellApplication {
      name = "restart-apps-updated-by";
      runtimeInputs = [
        pkgs.jq
        pkgs.coreutils
        restartAppPackage
      ];
      text = ''
        [ "$#" -ge 1 ] || { echo "usage: restart-apps-updated-by <installer> <tool>..." >&2; exit 2; }
        installer="$1"
        shift
        user="$(id -un)"
        for tool in "$@"; do
          jq -r --arg i "$installer" --arg t "$tool" --arg u "$user" \
            '.[] | select(.installer == $i and .tool == $t and .owner == $u) | .unit' \
            ${pkgs.writeText "apps-updated-by.json" (builtins.toJSON updated)}
        done | sort -u | while read -r unit; do
          echo "$unit: $installer upgraded what it runs"
          restart-app "$unit" || true
        done
      '';
    };

  # The waiter of an app that waits for idle: restarts the app's pending
  # units together, at once when none needs to wait, otherwise once every
  # idleCheck passes, and only once the switch's daemon-reload has loaded
  # their new definitions. `units` lists { unit, key, checked }; `idleChecks`
  # the app's idleCheck commands; `path` what goes first on PATH (the
  # owner's packages); `pinned` the app's name when it runs an npm pin, whose
  # programs then come first (the idleCheck asks the running version). Gives
  # up after `giveUpSeconds`; a timer starts it again.
  waiter =
    {
      name,
      units,
      idleChecks,
      path,
      pinned ? null,
      giveUpSeconds ? 86400,
    }:
    pkgs.writeShellScript "app-${name}-restart-when-idle" ''
      ${stateDir}
      ${etcDir}
      ${pinsDir}
      export PATH="${path}:$PATH"
      ${lib.optionalString (pinned != null) ''
        if current="$(cat "$pins/${pinned}/current" 2>/dev/null)"; then
          export PATH="$current/bin:$PATH"
        fi
      ''}
      ${pendingFunctions}
      # <unit> <key> <1 when its definition has an idleCheck>
      units=(${
        lib.concatMapStringsSep " " (
          u: lib.escapeShellArg "${u.unit} ${u.key} ${if u.checked then "1" else "0"}"
        ) units
      })
      idle() {
        ${lib.concatMapStringsSep " && " (check: "bash -c ${lib.escapeShellArg check}") idleChecks}
      }
      # Sets `pending` (units to restart), `gate` (one of them waits for
      # idle) and `loaded` (daemon-reload has loaded all their definitions).
      scan() {
        pending=()
        gate=
        loaded=1
        local entry unit key checked
        for entry in "''${units[@]}"; do
          read -r unit key checked <<<"$entry"
          systemctl is-active -q "$unit" || continue
          restart_pending "$key" || continue
          pending+=("$unit")
          if restart_gated "$key" "$checked"; then gate=1; fi
          # Until the switch's daemon-reload, a restart would start the old
          # definition.
          systemctl show -P ExecStartPost "$unit" | grep -qF -- "$(cat "$etc/$key.definition")" || loaded=
        done
      }
      announced=
      while [ "$SECONDS" -lt ${toString giveUpSeconds} ]; do
        scan
        if [ "''${#pending[@]}" -eq 0 ]; then
          echo "app-${name}: no restart pending"
          exit 0
        fi
        if [ -z "$loaded" ]; then
          sleep 5
          continue
        fi
        if [ -n "$gate" ]; then
          if ! idle; then
            if [ -z "$announced" ]; then
              echo "app-${name} is busy; restarting ''${pending[*]} once it is idle (or: sudo systemctl restart <unit>)"
              announced=1
            fi
            sleep 30
            continue
          fi
          # Work may have started, and the pending set changed, while the
          # check ran: look again right before restarting.
          scan
          [ "''${#pending[@]}" -gt 0 ] || continue
          if [ -n "$gate" ] && ! idle; then
            sleep 30
            continue
          fi
          echo "app-${name} is idle; restarting ''${pending[*]}"
        else
          echo "Restarting ''${pending[*]}"
        fi
        if systemctl try-restart "''${pending[@]}"; then
          exit 0
        fi
        echo "app-${name}: restarting ''${pending[*]} failed; retrying" >&2
        sleep 30
      done
      echo "<3>app-${name}: still busy after ${toString giveUpSeconds} s; giving up until the hourly retry. Restart its units with: sudo systemctl restart <unit>" >&2
      exit 1
    '';
}
