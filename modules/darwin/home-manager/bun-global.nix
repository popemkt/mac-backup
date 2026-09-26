{
  config,
  osConfig,
  lib,
  pkgs,
  ...
}:

let
  bunInstall = "${config.home.homeDirectory}/.bun";
  bunBin = "${pkgs.bun}/bin/bun";
  # Executor: stack-owned globals merged from the intent layer
  # (modules/stacks/*); add base entries here only if they fit no stack.
  bunGlobalPackages = lib.unique osConfig.my.pkgs.bunGlobals;

  updateBunGlobals = pkgs.writeShellScriptBin "update-bun-globals" ''
    set -euo pipefail

    export BUN_INSTALL=${lib.escapeShellArg bunInstall}
    export PATH="${pkgs.bun}/bin:$BUN_INSTALL/bin:$PATH"

    for pkg in ${lib.concatStringsSep " " (map lib.escapeShellArg bunGlobalPackages)}; do
      echo "Upgrading tracked Bun global: $pkg"
      ${lib.escapeShellArg bunBin} update --global --latest "$pkg"
    done
  '';
in
{
  # Read-only view of what this executor will install, so drift audits can
  # evaluate the resolved set instead of re-deriving it by scanning source.
  options.my.resolvedBunGlobals = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    readOnly = true;
    internal = true;
    default = bunGlobalPackages;
    description = "Merged Bun globals this host installs.";
  };

  config.home = {
    sessionVariables.BUN_INSTALL = bunInstall;
    packages = [ updateBunGlobals ];

    # Routine rebuilds only restore missing declarations. `update-system`
    # upgrades the declared globals with the Nix-owned Bun runtime.
    activation.installBunGlobals = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      export BUN_INSTALL=${lib.escapeShellArg bunInstall}
      export PATH="${pkgs.bun}/bin:$BUN_INSTALL/bin:$PATH"
      mkdir -p "$BUN_INSTALL/bin" "$BUN_INSTALL/install/global"

      # Converge best effort (AGENTS.md "Writing an executor"): the drift
      # audit reports whatever this skips as tracked but missing.
      for pkg in ${lib.concatStringsSep " " (map lib.escapeShellArg bunGlobalPackages)}; do
        package_dir="$BUN_INSTALL/install/global/node_modules/$pkg"
        if [ ! -d "$package_dir" ]; then
          echo "Installing missing Bun global: $pkg"
          $DRY_RUN_CMD ${lib.escapeShellArg bunBin} add --global "$pkg" \
            || echo "warning: could not install Bun global $pkg" >&2
        fi
      done
    '';
  };
}
