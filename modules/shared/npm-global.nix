{ config, pkgs, lib, ... }:

let
  npmPrefix = "${config.home.homeDirectory}/.local";
  npmGlobalPackages = [
    "gitnexus"
    "@openai/codex"
  ];
in
{
  # Keep npm -g installs out of /nix/store.
  home.file.".npmrc".text = lib.mkDefault ''
    prefix=${npmPrefix}
  '';

  # Ensure npm global executables are available in login shells.
  home.sessionPath = [ "${npmPrefix}/bin" ];

  # Install declared npm globals during activation for cross-machine bootstrap.
  home.activation.installNpmGlobals = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    export PATH="${npmPrefix}/bin:$PATH"
    export npm_config_prefix="${npmPrefix}"
    mkdir -p "${npmPrefix}/bin" "${npmPrefix}/lib/node_modules"

    for pkg in ${lib.concatStringsSep " " (map lib.escapeShellArg npmGlobalPackages)}; do
      if ! ${pkgs.nodejs}/bin/npm ls -g --depth=0 "$pkg" >/dev/null 2>&1; then
        $DRY_RUN_CMD ${pkgs.nodejs}/bin/npm install -g "$pkg"
      fi
    done
  '';
}
