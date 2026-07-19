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
      self,
      nixpkgs,
      nix-darwin,
      home-manager,
      ...
    }:
    let
      system = "aarch64-darwin";
      username = "popemkt";
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfreePredicate = pkg: nixpkgs.lib.getName pkg == "cursor-cli";
      };
      localPackages = import ./pkgs { inherit pkgs; };

      githubSources = pkgs.writeShellApplication {
        name = "github-sources";
        runtimeInputs = with pkgs; [
          coreutils
          curl
          diffutils
          git
          jq
          nvfetcher
        ];
        text = ''
          exec ${./scripts/github-sources} "$@"
        '';
      };

      # One Darwin host = shared system module + host dir (hosts/<hostname>).
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
              nixpkgs.overlays = [ self.overlays.default ];
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
                    ./modules/common/home-manager
                    ./modules/darwin/home-manager
                  ];
                };
              };
            })
          ];
        };
    in
    {
      overlays.default = final: _previous: import ./pkgs { pkgs = final; };

      packages.${system} = localPackages // {
        default = localPackages.cli-proxy-api;
      };

      checks.${system} = localPackages;

      apps.${system}.github-sources = {
        type = "app";
        program = "${githubSources}/bin/github-sources";
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
          actionlint
          deadnix
          nixfmt
          nvfetcher
          shellcheck
          statix
        ];
      };

      formatter.${system} = pkgs.nixfmt;

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
