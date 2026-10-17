{ config, lib, ... }:

# Identity only a macOS host has. A Mac is one person's workstation, so it has
# a primary user, and a role that splits work from personal configuration.
# flake.nix sets `my.username`; hosts/<name>/default.nix sets `my.role`.
#
# The primary user is the Mac's only person (`my.people`). Per-person software
# goes through `my.everyone`; `my.username` is for what macOS ties to the one
# logged-in session: launchd user agents and the state they own. Only
# macOS-side modules may read it; it does not exist on NixOS.
{
  config.my.people = [ config.my.username ];

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
