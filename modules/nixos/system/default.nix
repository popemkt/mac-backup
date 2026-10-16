{
  config,
  lib,
  pkgs,
  ...
}:

# The shared NixOS base: what every NixOS host here runs. A NixOS host is used
# by the people it lists in `my.people`; each gets an account and the same Home
# Manager layers, plus their own folder under users/.
{
  imports = [ ../../stacks/nixos.nix ];

  options.my.people = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    default = [ ];
    description = "Accounts of the people who use this host; each has a folder under users/.";
  };

  config = {
    # Keep the OS host name in sync with the flake attribute, so
    # `nixos-rebuild --flake ~/.dotfiles` selects this host.
    networking.hostName = config.my.hostname;

    nix.settings.experimental-features = [
      "nix-command"
      "flakes"
    ];

    # Prebuilt binaries (npm, curl installers, language toolchains) expect a
    # conventional dynamic loader; nix-ld provides one.
    programs.nix-ld.enable = true;

    # The login shell Home Manager configures for everyone.
    programs.zsh.enable = true;

    # Root and recovery need an editor and git without any user's Home Manager.
    programs.vim = {
      enable = true;
      defaultEditor = true;
    };
    environment.systemPackages = with pkgs; [
      gh
      git
    ];

    users.users = lib.genAttrs config.my.people (_: {
      isNormalUser = true;
      shell = pkgs.zsh;
    });

    home-manager.users = lib.genAttrs config.my.people (name: {
      imports = [
        ../../common/home-manager
        ../home-manager
        (../../../users + "/${name}")
      ];
      # Home Manager's state version starts with the host's.
      home.stateVersion = config.system.stateVersion;
      programs.home-manager.enable = true;
    });
  };
}
