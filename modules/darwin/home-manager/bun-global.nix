{
  config,
  osConfig,
  lib,
  ...
}:

let
  bunInstall = "${config.home.homeDirectory}/.bun";
  bunBin = "/opt/homebrew/bin/bun";
  # Executor: stack-owned globals merged from the intent layer
  # (modules/stacks/*); add base entries here only if they fit no stack.
  bunGlobalPackages = lib.unique osConfig.my.pkgs.bunGlobals;
in
{
  home = {
    sessionVariables.BUN_INSTALL = bunInstall;
    sessionPath = [ "${bunInstall}/bin" ];

    # Bun itself is a Homebrew formula so the runtime is upgraded before this
    # user activation. Refresh only the declared globals; unmanaged packages
    # are left alone and reported by sysaudit.
    activation.installBunGlobals = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      export BUN_INSTALL=${lib.escapeShellArg bunInstall}
      export PATH="$BUN_INSTALL/bin:/opt/homebrew/bin:$PATH"
      mkdir -p "$BUN_INSTALL/bin" "$BUN_INSTALL/install/global"

      if [ ! -x ${lib.escapeShellArg bunBin} ]; then
        echo "error: Bun is missing; expected Homebrew to install it before Home Manager activation" >&2
        exit 1
      fi

      for pkg in ${lib.concatStringsSep " " (map lib.escapeShellArg bunGlobalPackages)}; do
        package_dir="$BUN_INSTALL/install/global/node_modules/$pkg"
        if [ -d "$package_dir" ]; then
          echo "Upgrading tracked Bun global: $pkg"
          if ! $DRY_RUN_CMD ${lib.escapeShellArg bunBin} update --global --latest "$pkg"; then
            echo "warning: could not upgrade Bun global $pkg; keeping the installed version" >&2
          fi
        else
          echo "Installing missing Bun global: $pkg"
          $DRY_RUN_CMD ${lib.escapeShellArg bunBin} add --global "$pkg"
        fi
      done
    '';
  };
}
