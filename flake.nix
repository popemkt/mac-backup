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

    # Shared home-manager config
    homeConfig = { pkgs, ... }: {
      home.stateVersion = "24.05";
      programs.home-manager.enable = true;
      programs.git = {
        enable = true;
        userName = "Hoang Nguyen Gia";
        userEmail = "hoangng71299@gmail.com";
      };
    };
  in {
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
            users.${username} = homeConfig;
          };
        })
      ];
    };
  };
}
