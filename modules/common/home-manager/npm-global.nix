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
in
{
  home = {
    # Keep npm -g installs out of /nix/store.
    file.".npmrc".text = lib.mkDefault ''
      prefix=${npmPrefix}
    '';

    # Ensure npm global executables are available in login shells.
    sessionPath = [ "${npmPrefix}/bin" ];

    # Install missing globals and refresh existing ones on every rebuild.
    # A transient update failure must not block activation when the tool is
    # already usable; a first install still fails loudly.
    activation.installNpmGlobals = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      export PATH="${pkgs.nodejs}/bin:${npmPrefix}/bin:$PATH"
      export npm_config_prefix="${npmPrefix}"
      mkdir -p "${npmPrefix}/bin" "${npmPrefix}/lib/node_modules"

      for pkg in ${lib.concatStringsSep " " (map lib.escapeShellArg npmGlobalPackages)}; do
        if ${pkgs.nodejs}/bin/npm ls -g --depth=0 "$pkg" >/dev/null 2>&1; then
          echo "Upgrading tracked npm global: $pkg"
          if ! $DRY_RUN_CMD ${pkgs.nodejs}/bin/npm install -g "$pkg@latest"; then
            echo "warning: could not upgrade npm global $pkg; keeping the installed version" >&2
          fi
        else
          echo "Installing missing npm global: $pkg"
          $DRY_RUN_CMD ${pkgs.nodejs}/bin/npm install -g "$pkg@latest"
        fi
      done
    '';
  };
}
