{ pkgs }:
let
  inherit (pkgs) lib;
  home = "/npm-global-test-home";
  fakeNode = pkgs.runCommand "npm-global-test-node" { } ''
    mkdir -p "$out/bin"
    ln -s ${lib.getExe pkgs.nodejs} "$out/bin/node"
    ln -s ${fakeNpm} "$out/bin/npm"
  '';
  fakeNpm = pkgs.writeShellScript "fake-npm" ''
    case "$1" in
      ls)
        printf '%s\n' "$NPM_LISTING"
        exit "$NPM_LISTING_STATUS"
        ;;
      install)
        printf '%s\n' "$3" >> "$NPM_CALLS"
        [ "$3" != 'portless@latest' ]
        ;;
      *) exit 99 ;;
    esac
  '';
  module = import ./npm-global.nix {
    config = {
      home.homeDirectory = home;
      my.npmGlobalHealthChecks = { };
    };
    osConfig.my.pkgs.npmGlobals = [
      "repair"
      "healthy"
      "missing"
    ];
    pkgs = pkgs // {
      nodejs = fakeNode;
    };
    lib = lib // {
      hm.dag.entryAfter = _: data: data;
    };
  };
  activation = pkgs.writeShellScript "install-npm-globals-test" ''
    set -euo pipefail
    run() { "$@"; }
    ${module.config.home.activation.installNpmGlobals}
  '';
in
pkgs.runCommand "npm-global-activation-check"
  {
    nativeBuildInputs = [ pkgs.gnused ];
  }
  ''
    sed "s#${home}#$PWD/home#g" ${activation} > activation.sh
    prefix="$PWD/home/.local"
    mkdir -p "$prefix/bin" "$prefix/lib/node_modules/"{healthy,repair}
    printf '{"version":"1.2.3","bin":"cli.js"}\n' > "$prefix/lib/node_modules/repair/package.json"
    printf '{"version":"2.0.0","bin":"cli.js"}\n' > "$prefix/lib/node_modules/healthy/package.json"
    touch "$prefix/bin/healthy"
    chmod +x "$prefix/bin/healthy"
    export NPM_CALLS="$PWD/npm-calls"
    export NPM_LISTING_STATUS=1

    export NPM_LISTING='{"problems":["invalid: unrelated"],"dependencies":{"healthy":{},"repair":{},"missing":{"missing":true},"unrelated":{"invalid":true}}}'
    : > "$NPM_CALLS"
    bash activation.sh 2> warnings
    diff -u <(printf '%s\n' portless@latest repair@1.2.3 missing@latest) "$NPM_CALLS"
    grep -F 'invalid: unrelated' warnings
    grep -F 'warning: could not install npm global portless@latest' warnings

    for NPM_LISTING in 'not json' '{"error":{"code":"ENOENT"}}'; do
      : > "$NPM_CALLS"
      bash activation.sh 2> warnings
      test ! -s "$NPM_CALLS"
      grep -F 'warning: could not read npm globals' warnings
    done

    touch "$out"
  ''
