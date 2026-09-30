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

  updateNpmGlobals = pkgs.writeShellScriptBin "update-npm-globals" ''
    set -euo pipefail

    export PATH="${pkgs.nodejs}/bin:${npmPrefix}/bin:$PATH"
    export npm_config_prefix="${npmPrefix}"
    mkdir -p "${npmPrefix}/bin" "${npmPrefix}/lib/node_modules"

    for pkg in ${lib.concatStringsSep " " (map lib.escapeShellArg npmGlobalPackages)}; do
      echo "Upgrading tracked npm global: $pkg"
      ${pkgs.nodejs}/bin/npm install -g "$pkg@latest"
    done
  '';
in
{
  # Read-only view of what this executor will install, so drift audits can
  # evaluate the resolved set instead of re-deriving it by scanning source.
  options.my.resolvedNpmGlobals = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    readOnly = true;
    internal = true;
    default = npmGlobalPackages;
    description = "Merged npm globals this host installs.";
  };

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
      export PATH="${pkgs.nodejs}/bin:${npmPrefix}/bin:$PATH"
      export npm_config_prefix="${npmPrefix}"
      mkdir -p "${npmPrefix}/bin" "${npmPrefix}/lib/node_modules"

      for pkg in ${lib.concatStringsSep " " (map lib.escapeShellArg npmGlobalPackages)}; do
        if ! ${pkgs.nodejs}/bin/npm ls -g --depth=0 "$pkg" >/dev/null 2>&1; then
          echo "Installing missing npm global: $pkg"
          $DRY_RUN_CMD ${pkgs.nodejs}/bin/npm install -g "$pkg@latest"
        elif [ "$pkg" = "@openai/codex" ] \
          && { [ ! -x "${npmPrefix}/bin/codex" ] \
            || ! "${npmPrefix}/bin/codex" --version >/dev/null 2>&1; }; then
          # Codex ships its native binary as an optional platform dependency
          # (@openai/codex-darwin-arm64 and friends). `npm ls` still succeeds
          # when that dependency is absent, and `npm rebuild` only relinks the
          # bin shim, so neither check above notices. An install killed before
          # npm reifies — it moves the old tree aside first — leaves exactly
          # that state: a valid package.json, no runnable Codex. Only a full
          # reinstall restores the platform package. Reinstall the version
          # already there: a routine rebuild repairs, it never upgrades.
          ver="$(${pkgs.nodejs}/bin/node -p "require('${npmPrefix}/lib/node_modules/@openai/codex/package.json').version" 2>/dev/null || echo latest)"
          echo "Repairing Codex $ver: platform binary missing or not runnable"
          $DRY_RUN_CMD ${pkgs.nodejs}/bin/npm install -g "$pkg@$ver"
        fi
      done
    '';
  };
}
