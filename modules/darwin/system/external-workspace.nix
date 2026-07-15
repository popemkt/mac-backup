{ config, ... }:

let
  inherit (config.my) username;
  externalVolume = "/Volumes/Data";
  externalDataRoot = "${externalVolume}/workspace/symlinks/User";
  managedPaths = [
    ".ollama"
    ".local/share/uv"
    "Library/Application Support/Claude/vm_bundles"
  ];
in
{
  # /etc/synthetic.conf entries are read by apfs.util at boot:
  #   nix            - empty mountpoint for the Determinate /nix APFS volume
  #   stuff -> /Volumes/Data - stable path to the external workspace volume
  #
  # nix-darwin already appends `run`; this module appends the custom entries.
  # Takes effect after reboot.
  system.activationScripts.extraActivation.text = ''
    if ! /usr/bin/grep -q '^nix$' /etc/synthetic.conf 2>/dev/null; then
      echo "adding nix mountpoint to /etc/synthetic.conf..."
      echo 'nix' | /usr/bin/tee -a /etc/synthetic.conf >/dev/null
    fi
    if ! /usr/bin/grep -q '^stuff\b' /etc/synthetic.conf 2>/dev/null; then
      echo "adding /stuff -> ${externalVolume} to /etc/synthetic.conf..."
      /usr/bin/printf 'stuff\t${externalVolume}\n' | /usr/bin/tee -a /etc/synthetic.conf >/dev/null
    fi
  '';

  home-manager.users.${username} =
    { config, lib, ... }:
    let
      homeDir = config.home.homeDirectory;
      renderMigration =
        relativePath:
        let
          src = "${homeDir}/${relativePath}";
          dst = "${externalDataRoot}/${relativePath}";
        in
        ''
          src=${lib.escapeShellArg src}
          dst=${lib.escapeShellArg dst}

          $DRY_RUN_CMD mkdir -p "$(dirname "$src")" "$(dirname "$dst")"

          if [ -L "$src" ]; then
            current_target="$(readlink "$src")"
            if [ "$current_target" != "$dst" ]; then
              echo "warning: $src already points to $current_target, expected $dst" >&2
            fi
          elif [ -e "$src" ]; then
            if [ -e "$dst" ]; then
              echo "warning: refusing to migrate $src because both source and target exist" >&2
            else
              $DRY_RUN_CMD mv "$src" "$dst"
              $DRY_RUN_CMD ln -s "$dst" "$src"
            fi
          else
            $DRY_RUN_CMD mkdir -p "$dst"
            $DRY_RUN_CMD ln -s "$dst" "$src"
          fi
        '';
    in
    {
      home.activation.migrateExternalData = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        if [ ! -d "${externalVolume}" ]; then
          echo "Skipping external data migration: ${externalVolume} is not mounted" >&2
        else
          $DRY_RUN_CMD mkdir -p ${lib.escapeShellArg externalDataRoot}
          ${lib.concatMapStringsSep "\n" renderMigration managedPaths}
        fi
      '';
    };
}
