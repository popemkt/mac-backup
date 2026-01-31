{
  description = "popemkt's macOS configuration";

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
    # Change to "x86_64-darwin" for Intel Mac
    system = "aarch64-darwin";

    # Your username and hostname
    username = "popemkt";
    hostname = "popemkt-mac";  # Change this: run `hostname` to find yours
  in
  {
    darwinConfigurations.${hostname} = nix-darwin.lib.darwinSystem {
      inherit system;

      specialArgs = { inherit inputs username; };

      modules = [
        ./modules/darwin.nix

        home-manager.darwinModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.users.${username} = import ./modules/home.nix;
          home-manager.extraSpecialArgs = { inherit username; };
        }
      ];
    };
  };
}
