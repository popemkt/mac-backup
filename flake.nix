{
  description = "Declarative macOS configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";

    nix-darwin = {
      url = "github:LnL7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nix-darwin,
      home-manager,
      ...
    }:
    let
      username = "popemkt";

      # One darwin host = base (hosts/darwin) + host dir (hosts/<hostname>).
      # Host identity lives in the typed `my.*` options (modules/my.nix),
      # not in specialArgs.
      mkDarwin =
        hostname:
        nix-darwin.lib.darwinSystem {
          modules = [
            (./hosts + "/${hostname}")

            ./modules/options
            {
              my = { inherit username hostname; };
            }

            home-manager.darwinModules.home-manager
            (_: {
              users.users.${username}.home = "/Users/${username}";
              home-manager = {
                useGlobalPkgs = true;
                useUserPackages = true;
                backupFileExtension = "backup";
                users.${username} = _: {
                  home.stateVersion = "24.05";
                  programs.home-manager.enable = true;

                  imports = [
                    ./modules/shared
                    ./modules/darwin
                  ];
                };
              };
            })
          ];
        };
    in
    {
      # ========================================================================
      # DARWIN (macOS) CONFIGURATIONS
      # ========================================================================
      # `rebuild` picks the attribute matching this machine's hostname.

      darwinConfigurations = {
        popemkt-work = mkDarwin "popemkt-work";
        popemkt-personal = mkDarwin "popemkt-personal";
      };

      # NixOS modules are kept in-tree for future use, but this flake only
      # exposes complete, actively maintained host configurations.
    };
}
