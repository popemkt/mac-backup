{
  config,
  osConfig,
  pkgs,
  lib,
  ...
}:

let
  npmPrefix = "${config.home.homeDirectory}/.local";
  # Executor: base entries with no stack membership + stack-owned globals
  # merged from the intent layer (modules/stacks/*).
  npmGlobalPackages = lib.unique (
    [
      "portless"
    ]
    ++ osConfig.my.pkgs.npmGlobals
  );

  updateNpmGlobals = pkgs.writeShellScriptBin "update-npm-globals" (
    ''
      set -euo pipefail

      export PATH="${pkgs.nodejs}/bin:${npmPrefix}/bin:$PATH"
      export npm_config_prefix="${npmPrefix}"
      mkdir -p "${npmPrefix}/bin" "${npmPrefix}/lib/node_modules"

      version() {
        ${pkgs.nodejs}/bin/node -p "require('${npmPrefix}/lib/node_modules/$1/package.json').version" 2>/dev/null || true
      }

      changed=()
      for pkg in ${lib.concatStringsSep " " (map lib.escapeShellArg npmGlobalPackages)}; do
        echo "Upgrading tracked npm global: $pkg"
        before="$(version "$pkg")"
        ${pkgs.nodejs}/bin/npm install -g "$pkg@latest"
        [ "$(version "$pkg")" = "$before" ] || changed+=("$pkg")
      done
    ''
    # Apps this host runs from an npm global (my.services.<app>.updatedBy)
    # restart onto the new version.
    + lib.optionalString (osConfig.my.restartAppsUpdatedBy != null) ''
      if [ "''${#changed[@]}" -gt 0 ]; then
        ${lib.getExe osConfig.my.restartAppsUpdatedBy} npmGlobal "''${changed[@]}"
      fi
    ''
  );
in
{
  config.my.packageExecutors.npmGlobals = npmGlobalPackages;

  config.home = {
    # Keep npm -g installs out of /nix/store.
    file.".npmrc".text = lib.mkDefault ''
      prefix=${npmPrefix}
    '';

    # Ensure npm global executables are available in login shells.
    sessionPath = [ "${npmPrefix}/bin" ];

    packages = [ updateNpmGlobals ];

    # Routine rebuilds only restore missing declarations. `update-system`
    # invokes update-npm-globals when network-backed upgrades are intentional.
    activation.installNpmGlobals = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      (
        export npm_config_prefix=${lib.escapeShellArg npmPrefix}
        export PATH="${pkgs.nodejs}/bin:$npm_config_prefix/bin:$PATH"
        npm=${pkgs.nodejs}/bin/npm
        node=${pkgs.nodejs}/bin/node
        listing_status=0
        installed="$("$npm" ls -g --depth=0 --json)" || listing_status=$?
        # npm uses exit 1 for ELSPROBLEMS even when it returns a usable
        # dependency map. Missing entries in that map still need installation.
        if ! names="$(
          ${lib.getExe pkgs.jq} -ers --argjson status "$listing_status" '
            if length != 1 or (.[0] | type != "object") then error("expected one npm listing")
            else .[0] end
            | if $status == 0 and .dependencies == null then {}
              elif ($status == 0 or $status == 1) and (.dependencies | type == "object") then .dependencies
              else error("npm did not return a dependency map") end
            | to_entries | map(select(.value.missing != true) | .key) | join("\n")
          ' <<<"$installed"
        )"; then
          echo "warning: could not read npm globals; skipping activation installs" >&2
          exit 0
        fi
        if [ "$listing_status" -eq 1 ]; then
          echo "warning: npm reported problems in the global tree; continuing activation installs" >&2
          ${lib.getExe pkgs.jq} -r '.problems[]?' <<<"$installed" >&2
        fi

        stack_health_check() {
          case "$1" in
            ${lib.concatStringsSep "\n" (
              lib.mapAttrsToList (name: probe: ''
                ${lib.escapeShellArg name}) ${probe} "$npm_config_prefix/bin" >/dev/null 2>&1 ;;
              '') config.my.npmGlobalHealthChecks
            )}
            *) return 0 ;;
          esac
        }

        for pkg in ${lib.concatStringsSep " " (map lib.escapeShellArg npmGlobalPackages)}; do
          if ! ${pkgs.gnugrep}/bin/grep -qxF -- "$pkg" <<<"$names"; then
            version=latest
            echo "Installing missing npm global: $pkg"
          elif version="$("$node" ${./npm-global-health.cjs} "$npm_config_prefix" "$pkg")" \
            && stack_health_check "$pkg"; then
            continue
          elif [ -n "$version" ]; then
            echo "Repairing npm global: $pkg@$version"
          else
            echo "warning: could not determine installed version of $pkg; skipping repair" >&2
            continue
          fi
          run "$npm" install -g "$pkg@$version" \
            || echo "warning: could not install npm global $pkg@$version" >&2
        done
      )
    '';
  };

  options.my.npmGlobalHealthChecks = lib.mkOption {
    type = lib.types.attrsOf lib.types.path;
    default = { };
    internal = true;
    description = "Optional executable health probes by npm package name. Each gets the npm global bin directory as its argument.";
  };
}
