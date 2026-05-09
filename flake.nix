{
  description = "Cross-platform Nix configuration";

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
      nixpkgs,
      nix-darwin,
      home-manager,
      ...
    }:
    let
      username = "popemkt";
      hostname = "${username}-mac";
    in
    {
      # ========================================================================
      # DARWIN (macOS) CONFIGURATIONS
      # ========================================================================

      darwinConfigurations.${hostname} = nix-darwin.lib.darwinSystem {
        system = "aarch64-darwin";
        specialArgs = { inherit username hostname; };
        modules = [
          ./hosts/darwin

          home-manager.darwinModules.home-manager
          (_: {
            users.users.${username}.home = "/Users/${username}";
            home-manager = {
              useGlobalPkgs = true;
              useUserPackages = true;
              backupFileExtension = "backup";
              extraSpecialArgs = { inherit username hostname; };
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

      # ========================================================================
      # NIXOS (Linux) CONFIGURATIONS
      # ========================================================================

      nixosConfigurations."nixos" = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        specialArgs = { inherit username hostname; };
        modules = [
          ./hosts/nixos

          home-manager.nixosModules.home-manager
          (_: {
            home-manager = {
              useGlobalPkgs = true;
              useUserPackages = true;
              backupFileExtension = "backup";
              extraSpecialArgs = { inherit username hostname; };
              users.${username} = _: {
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
