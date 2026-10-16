{ lib, ... }:

# Typed identity every host has, whatever its platform. flake.nix sets the
# host name. Platform-specific identity is declared by the platform that
# reads it (modules/darwin/system/identity.nix). Modules read these via
# `config.my.*` (system) or `osConfig.my.*` (home-manager) instead of untyped
# specialArgs.
{
  options.my.hostname = lib.mkOption {
    type = lib.types.str;
    description = "Host name; must match the host's flake configuration attribute name.";
  };
}
