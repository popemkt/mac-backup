{
  description = "popemkt's cross-platform Nix configuration";

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

  outputs = inputs@{ self, nixpkgs, nix-darwin, home-manager, ... }:
  let
    username = "popemkt";
  in {
    # ========================================================================
    # DARWIN (macOS) CONFIGURATIONS
    # ========================================================================

    darwinConfigurations."popemkt-mac" = nix-darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      modules = [
        ./hosts/darwin

        home-manager.darwinModules.home-manager
        ({ config, ... }: {
          users.users.${username}.home = "/Users/${username}";
          home-manager = {
            useGlobalPkgs = true;
            useUserPackages = true;
            backupFileExtension = "backup";
            users.${username} = { pkgs, lib, ... }: {
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

    # ========================================================================
    # NIXOS (Linux) CONFIGURATIONS
    # ========================================================================

    nixosConfigurations."nixos" = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./hosts/nixos

        home-manager.nixosModules.home-manager
        ({ config, ... }: {
          home-manager = {
            useGlobalPkgs = true;
            useUserPackages = true;
            backupFileExtension = "backup";
            users.${username} = { pkgs, lib, ... }: {
              home.stateVersion = "24.05";
              programs.home-manager.enable = true;

              imports = [
                ./modules/shared
                ./modules/nixos
              ];
            };
          };
        })
      ];
    };
  };
}
