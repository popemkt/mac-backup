{ lib, ... }:

# Typed options shared by every host. Declared once here, defined per host
# (hosts/<name>/default.nix sets `my.role`; flake.nix sets username/hostname).
# Modules read them via `config.my.*` (system) or `osConfig.my.*` (home-manager)
# instead of untyped specialArgs.
{
  options.my = {
    username = lib.mkOption {
      type = lib.types.str;
      description = "Primary user account name.";
    };

    hostname = lib.mkOption {
      type = lib.types.str;
      description = "Host name; must match the darwinConfigurations attribute name.";
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
