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

    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
    };

    pyproject-build-systems = {
      url = "github:pyproject-nix/build-system-pkgs";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.uv2nix.follows = "uv2nix";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      nix-darwin,
      home-manager,
      pyproject-build-systems,
      pyproject-nix,
      uv2nix,
      ...
    }:
    let
      system = "aarch64-darwin";
      # Systems the repo's own tooling (dev shell, formatter) runs on: the
      # Macs and the NixOS server.
      toolingSystems = [
        "aarch64-darwin"
        "x86_64-linux"
      ];
      username = "popemkt";
      pkgsFor =
        system:
        import nixpkgs {
          inherit system;
          config.allowUnfreePredicate =
            pkg:
            builtins.elem (nixpkgs.lib.getName pkg) [
              "chat2db"
              "cursor-cli"
            ];
        };
      pkgs = pkgsFor system;
      localPackages = import ./pkgs {
        inherit
          pkgs
          pyproject-build-systems
          pyproject-nix
          uv2nix
          ;
      };

      systemSetupCheck =
        pkgs.runCommand "system-setup-check"
          {
            nativeBuildInputs = [ localPackages.system-setup-dev ];
          }
          ''
              cp -R ${./tools/system-setup} source
              chmod -R u+w source
              cd source
              ruff check .
              ruff format --check .
              pyrefly check src tests
              pytest
            touch "$out"
          '';

      systemSetupManifestCheck =
        hostname:
        let
          manifest = self.darwinConfigurations.${hostname}.config.my.systemSetup.manifest;
        in
        pkgs.runCommand "system-setup-manifest-${hostname}"
          {
            nativeBuildInputs = [ localPackages.system-setup ];
          }
          ''
            system-setup validate-manifest --manifest ${manifest}
            touch "$out"
          '';

      # The github-sources app around a given nvfetcher: the real one for the
      # flake app, a fixture stub for its test, so both run the same wrapper.
      # The script runs under the app's own bash, never whatever `env bash`
      # finds: on a minimal PATH that is macOS's /bin/bash 3.2.
      mkGithubSources =
        pkgs: nvfetcher:
        pkgs.writeShellApplication {
          name = "github-sources";
          runtimeInputs = with pkgs; [
            coreutils
            curl
            diffutils
            git
            jq
            nvfetcher
            remarshal
          ];
          text = ''
            exec ${pkgs.lib.getExe pkgs.bash} ${./scripts/github-sources} "$@"
          '';
        };

      # Offline fixture test of the app, run as CI runs it (env -i, empty
      # HOME, no TMPDIR, PATH=/usr/bin:/bin).
      githubSourcesCheck =
        let
          app = mkGithubSources pkgs (
            pkgs.writeShellScriptBin "nvfetcher" (builtins.readFile ./scripts/tests/nvfetcher-stub.sh)
          );
        in
        pkgs.runCommand "github-sources-check"
          {
            nativeBuildInputs = with pkgs; [
              bash
              coreutils
              gnugrep
            ];
          }
          ''
            bash ${./scripts/tests/github-sources-check.sh} \
              ${app}/bin/github-sources ${./scripts/github-sources}
            touch "$out"
          '';

      # Unit tests of the activation reconcilers (scripts/reconcile_*.py).
      reconcileScriptsCheck =
        pkgs.runCommand "reconcile-scripts-check"
          {
            nativeBuildInputs = [ pkgs.python3 ];
          }
          ''
            python3 -m unittest discover \
              -s ${
                pkgs.lib.fileset.toSource {
                  root = ./scripts;
                  fileset = pkgs.lib.fileset.fileFilter (
                    file: pkgs.lib.hasInfix "reconcile_" file.name && file.hasExt "py"
                  ) ./scripts;
                }
              }/tests \
              -p 'test_reconcile_*.py'
            touch "$out"
          '';

      # Offline tests of the drift audit's sourced libraries: the probe
      # mechanism and the /Applications report.
      auditLibCheck =
        pkgs.runCommand "audit-lib-check"
          {
            nativeBuildInputs = [
              pkgs.bash
              pkgs.coreutils
              pkgs.gnugrep
              pkgs.gnused
            ];
          }
          ''
            bash ${./scripts/tests/audit-probes.sh} ${./scripts/lib/audit-probes.sh}
            bash ${./scripts/tests/audit-apps.sh} ${./scripts/lib/audit-probes.sh} ${./scripts/lib/audit-apps.sh}
            touch "$out"
          '';

      # What every host shares, whatever its platform: the typed options,
      # its name, the tailnet it joins, and this repo's package overlay.
      # Host identity lives in the typed `my.*` options (modules/options),
      # not in specialArgs.
      hostBase = hostname: [
        (./hosts + "/${hostname}")
        ./modules/options
        {
          my = {
            inherit hostname;
            stacks.vpn = {
              tailnetDomain = "taild98079.ts.net";
              knownDevices = {
                work = "100.114.213.27";
                pocoF8Pro = "100.70.17.62";
                xiaomiPad7 = "100.124.163.25";
              };
            };
          };
          nixpkgs.overlays = [ self.overlays.default ];
        }
      ];

      # Home Manager as every host runs it; hosts add their users.
      homeManagerBase = {
        useGlobalPkgs = true;
        useUserPackages = true;
        backupFileExtension = "backup";
        # Preserve the latest pre-managed file without failing when a
        # previous activation already created the fixed-name backup.
        overwriteBackup = true;
      };

      # One Darwin host = the host base + one primary user, popemkt, who is
      # the host's only person (my.people).
      mkDarwin =
        hostname:
        nix-darwin.lib.darwinSystem {
          modules = hostBase hostname ++ [
            { my = { inherit username; }; }

            home-manager.darwinModules.home-manager
            (
              { config, lib, ... }:
              {
                users.users = lib.genAttrs config.my.people (name: {
                  home = "/Users/${name}";
                });
                home-manager = homeManagerBase // {
                  users = lib.genAttrs config.my.people (name: {
                    home.stateVersion = "24.05";
                    programs.home-manager.enable = true;

                    imports = [
                      ./modules/common/home-manager
                      ./modules/darwin/home-manager
                      (./users + "/${name}")
                      config.my.everyone
                    ];
                  });
                };
              }
            )
          ];
        };

      # One NixOS host = the host base + the people it lists (my.people); the
      # NixOS base gives each an account and their Home Manager layers.
      mkNixos =
        hostname:
        nixpkgs.lib.nixosSystem {
          modules = hostBase hostname ++ [
            home-manager.nixosModules.home-manager
            { home-manager = homeManagerBase; }
          ];
        };
    in
    {
      overlays.default =
        final: _previous:
        import ./pkgs {
          pkgs = final;
          inherit
            pyproject-build-systems
            pyproject-nix
            uv2nix
            ;
        };

      packages.${system} = localPackages // {
        default = localPackages.cli-proxy-api;
      };

      checks.${system} = localPackages // {
        inherit systemSetupCheck;
        reconcile-scripts-check = reconcileScriptsCheck;
        audit-lib-check = auditLibCheck;
        github-sources-check = githubSourcesCheck;
        system-setup-manifest-personal = systemSetupManifestCheck "popemkt-personal";
        system-setup-manifest-work = systemSetupManifestCheck "popemkt-work";
        darwin-personal = self.darwinConfigurations.popemkt-personal.system;
        darwin-work = self.darwinConfigurations.popemkt-work.system;
      };

      # Per tooling system: the pre-commit gate runs `nix run .#github-sources`
      # on whichever host commits, so Linux needs it too, built from its own pkgs.
      apps = nixpkgs.lib.genAttrs toolingSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          github-sources = {
            type = "app";
            program = "${mkGithubSources pkgs pkgs.nvfetcher}/bin/github-sources";
          };
        }
      );

      devShells = nixpkgs.lib.genAttrs toolingSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            # The gate's hard tools (intent/gate.sh) all come from here, kb
            # among them: the same release `pkgs/kb` installs, so the hook and
            # CI check kb data with the kb every host runs.
            packages = with pkgs; [
              (pkgs.extend self.overlays.default).kb
              actionlint
              deadnix
              jq
              nixfmt
              nvfetcher
              shellcheck
              statix
            ];
          };
        }
      );

      formatter = nixpkgs.lib.genAttrs toolingSystems (system: (pkgsFor system).nixfmt);

      # ========================================================================
      # DARWIN (macOS) CONFIGURATIONS
      # ========================================================================
      # `rebuild` picks the attribute matching this machine's hostname.

      darwinConfigurations = {
        popemkt-work = mkDarwin "popemkt-work";
        popemkt-personal = mkDarwin "popemkt-personal";
      };

      # ========================================================================
      # NIXOS CONFIGURATIONS
      # ========================================================================

      nixosConfigurations = {
        shared-server = mkNixos "shared-server";
      };
    };
}
