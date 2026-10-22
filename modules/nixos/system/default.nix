{
  config,
  lib,
  pkgs,
  ...
}:

# The shared NixOS base: what every NixOS host here runs. A NixOS host is used
# by the people it lists in `my.people`; each gets an account and the same Home
# Manager layers, plus their own folder under users/ (modules/options/people.nix).
{
  imports = [
    ../../stacks/nixos.nix
    ./services.nix
  ];

  config = {
    # Keep the OS host name in sync with the flake attribute, so
    # `nixos-rebuild --flake ~/.dotfiles` selects this host.
    networking.hostName = config.my.hostname;

    nix.settings.experimental-features = [
      "nix-command"
      "flakes"
    ];

    # Prebuilt binaries (npm, curl installers, language toolchains) expect a
    # conventional dynamic loader; nix-ld provides one, with the libraries
    # stacks contribute to the my.pkgs.nixLdLibraries channel.
    programs.nix-ld = {
      enable = true;
      libraries = map (name: pkgs.${name}) (lib.unique config.my.pkgs.nixLdLibraries);
    };

    # Vulkan loaders bundled with prebuilt binaries (Chromium's among them)
    # search /etc/vulkan, not /run/opengl-driver where NixOS puts the drivers
    # and their implicit layers; link them there so every loader finds them.
    environment.etc."vulkan/icd.d" = lib.mkIf config.hardware.graphics.enable {
      source = "/run/opengl-driver/share/vulkan/icd.d";
    };
    environment.etc."vulkan/implicit_layer.d" = lib.mkIf config.hardware.graphics.enable {
      source = "/run/opengl-driver/share/vulkan/implicit_layer.d";
    };

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

    # A host several people apply from: scripts/rebuild reads this marker and
    # switches only from a clean checkout at origin/main, so no one's stale
    # or uncommitted tree rolls back what the others applied.
    environment.etc."dotfiles/shared-host" = lib.mkIf (lib.length config.my.people > 1) {
      text = lib.concatStringsSep "\n" config.my.people + "\n";
    };

    users.users = lib.genAttrs config.my.people (_: {
      isNormalUser = true;
      shell = pkgs.zsh;
    });

    home-manager.users = lib.genAttrs config.my.people (name: {
      imports = [
        ../../common/home-manager
        ../home-manager
        (../../../users + "/${name}")
        config.my.everyone
      ];
      # Home Manager's state version starts with the host's.
      home.stateVersion = config.system.stateVersion;
      programs.home-manager.enable = true;
    });
  };
}
