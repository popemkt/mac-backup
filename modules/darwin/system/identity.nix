{ lib, ... }:

# Identity only a macOS host has. A Mac is one person's workstation, so it has
# a primary user, and a role that splits work from personal configuration.
# flake.nix sets `my.username`; hosts/<name>/default.nix sets `my.role`.
{
  options.my = {
    username = lib.mkOption {
      type = lib.types.str;
      description = "Primary user account name.";
    };

    role = lib.mkOption {
      type = lib.types.enum [
        "work"
        "personal"
      ];
      description = "Machine role, for conditional config (lib.mkIf (config.my.role == \"work\") ...).";
    };
  };
}
