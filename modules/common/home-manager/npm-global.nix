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
        elif [ "$pkg" = "@openai/codex" ] && [ ! -x "${npmPrefix}/bin/codex" ]; then
          echo "Relinking missing Codex executable"
          $DRY_RUN_CMD ${pkgs.nodejs}/bin/npm rebuild -g "$pkg"
        fi
      done
    '';
  };
}
