{ lib, ... }:

# Who uses a host, whatever its platform. Each platform base gives every
# person an account and the same Home Manager layers (common, platform, their
# users/<name> folder, and `my.everyone`). A NixOS host lists its people; a
# Mac's one person is its primary user (modules/darwin/system/identity.nix).
{
  options.my = {
    people = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Accounts of the people who use this host; each has a folder under users/.";
    };

    everyone = lib.mkOption {
      type = lib.types.deferredModule;
      default = { };
      description = ''
        Home Manager configuration every person on this host receives. A stack
        installs per-person software here instead of naming an account, and
        reads that person's paths from the Home Manager `config.home`.
      '';
    };
  };
}
