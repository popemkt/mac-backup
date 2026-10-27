{
  lib,
  writeShellApplication,
  runCommand,
  # Chromium switches, e.g. "--enable-blink-features=CanvasDrawElement".
  switches,
}:

# `bb Launcher.app` and `bb-launch`: start the bb desktop app with Chromium
# switches it has no setting for. bb (Electron) reads switches only from its
# command line: no `app.commandLine` config, no flags file, no Local State
# `enabled_labs_experiments`, and its NODE_OPTIONS are limited in a packaged
# app. So the launcher goes through LaunchServices with `open --args`, which
# keeps the real bundle (auto-updates, signature, single instance) untouched.
#
# - bb not running: start it with the switches.
# - bb running with them: bring it forward.
# - bb running without them (a Dock or Spotlight launch of bb itself, or the
#   relaunch after an in-app update, which drops arguments): offer to restart it
#   with them.
#
# `bb-launch -n [switch…]` starts a separate instance and skips the checks;
# pair it with `--user-data-dir=<dir>` to test without touching the running bb.
let
  bundleId = "dev.bb.desktop";
  launch = writeShellApplication {
    name = "bb-launch";
    text = ''
      switches=(${lib.escapeShellArgs switches})

      if [ "''${1:-}" = "-n" ]; then
        shift
        exec /usr/bin/open -n -b ${bundleId} --args "''${switches[@]}" "$@"
      fi

      # bb's main process; its helpers are named "bb Helper…". An instance
      # with its own --user-data-dir is a test copy, not the person's bb.
      # A process ps cannot read (it just exited) is skipped, never taken for bb.
      main_pid=""
      main_args=""
      while read -r pid; do
        if ! cmdline="$(/bin/ps -o args= -p "$pid")"; then continue; fi
        case "$cmdline" in
          *--user-data-dir=*) ;;
          *)
            main_pid="$pid"
            main_args="$cmdline"
            ;;
        esac
      done < <(/usr/bin/pgrep -x -u "$(/usr/bin/id -u)" bb || true)

      if [ -z "$main_pid" ]; then
        exec /usr/bin/open -b ${bundleId} --args "''${switches[@]}"
      fi

      args="$main_args "
      missing=()
      for s in "''${switches[@]}"; do
        case "$args" in *" $s "*) ;; *) missing+=("$s") ;; esac
      done
      if [ "''${#missing[@]}" -eq 0 ]; then
        exec /usr/bin/open -b ${bundleId}
      fi

      answer="$(/usr/bin/osascript \
        -e 'on run argv' \
        -e 'activate' \
        -e 'display dialog "bb is running without " & item 1 of argv & ". Quit bb and start it again with them?" buttons {"Not now", "Restart bb"} default button "Not now" cancel button "Not now" with title "bb Launcher"' \
        -e 'return button returned of result' \
        -e 'end run' \
        "''${missing[*]}" 2>/dev/null || true)"
      if [ "$answer" != "Restart bb" ]; then
        exec /usr/bin/open -b ${bundleId}
      fi

      # Electron quits gracefully on SIGTERM (its ShutdownDetector calls the app's
      # quit, which runs before-quit and will-quit, as Cmd-Q does). It goes to this
      # one process: a quit by bundle id could reach a test copy instead. If bb
      # already exited, there is nothing to wait for.
      kill -TERM "$main_pid" 2>/dev/null || true
      for ((i = 0; i < 60; i++)); do
        kill -0 "$main_pid" 2>/dev/null || break
        /bin/sleep 0.5
      done
      if kill -0 "$main_pid" 2>/dev/null; then
        /usr/bin/osascript -e 'display alert "bb did not quit within 30 s; quit it, then open bb Launcher again."' >/dev/null 2>&1 || true
        exit 1
      fi
      exec /usr/bin/open -b ${bundleId} --args "''${switches[@]}"
    '';
  };
in
runCommand "bb-launcher" { meta.mainProgram = "bb-launch"; } ''
  mkdir -p "$out/bin" "$out/Applications/bb Launcher.app/Contents/MacOS"
  ln -s ${lib.getExe launch} "$out/bin/bb-launch"
  ln -s ${lib.getExe launch} "$out/Applications/bb Launcher.app/Contents/MacOS/bb-launch"
  cat > "$out/Applications/bb Launcher.app/Contents/Info.plist" <<'EOF'
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>CFBundleExecutable</key><string>bb-launch</string>
    <key>CFBundleIdentifier</key><string>com.popemkt.bb-launcher</string>
    <key>CFBundleName</key><string>bb Launcher</string>
    <key>CFBundleDisplayName</key><string>bb Launcher</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>LSUIElement</key><true/>
  </dict>
  </plist>
  EOF
''
