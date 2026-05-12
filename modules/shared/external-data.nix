{ config, lib, ... }:

let
  homeDir = config.home.homeDirectory;
  # DEPRECATED: external-data.nix symlinks are kept for backwards compatibility
  # but new large directories should use synthetic mounts via /etc/synthetic.conf
  # instead of per-directory symlinks. See hosts/darwin/default.nix.
  externalDataRoot = "/Volumes/Data/workspace/symlinks/User";
  managedPaths = [
    ".ollama"
    ".local/share/uv"
    "Library/Application Support/Claude/vm_bundles"
  ];
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
    if [ ! -d "/Volumes/Data" ]; then
      echo "Skipping external data migration: /Volumes/Data is not mounted" >&2
    else
      $DRY_RUN_CMD mkdir -p ${lib.escapeShellArg externalDataRoot}
      ${lib.concatMapStringsSep "\n" renderMigration managedPaths}
    fi
  '';
}
