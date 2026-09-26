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

    # Keep in step with the `bun2nix` catalog entry in tools/kb/package.json:
    # that CLI writes tools/kb/bun.nix, this input's fetchBunDeps reads it.
    bun2nix = {
      url = "github:nix-community/bun2nix/2.1.2";
      inputs.nixpkgs.follows = "nixpkgs";
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
      bun2nix,
      pyproject-build-systems,
      pyproject-nix,
      uv2nix,
      ...
    }:
    let
      system = "aarch64-darwin";
      username = "popemkt";
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfreePredicate =
          pkg:
          builtins.elem (nixpkgs.lib.getName pkg) [
            "chat2db"
            "cursor-cli"
          ];
      };
      localPackages = import ./pkgs {
        inherit
          pkgs
          bun2nix
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
        nvfetcher:
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

      githubSources = mkGithubSources pkgs.nvfetcher;

      # Offline fixture test of the app, run as CI runs it (env -i, empty
      # HOME, no TMPDIR, PATH=/usr/bin:/bin).
      githubSourcesCheck =
        let
          app = mkGithubSources (
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

      # Offline test of the drift audit's probe mechanism.
      auditProbesCheck =
        pkgs.runCommand "audit-probes-check"
          {
            nativeBuildInputs = [
              pkgs.bash
              pkgs.coreutils
              pkgs.gnused
            ];
          }
          ''
            bash ${./scripts/tests/audit-probes.sh} ${./scripts/lib/audit-probes.sh}
            touch "$out"
          '';

      # One Darwin host = shared system module + host dir (hosts/<hostname>).
      # Host identity lives in the typed `my.*` options (modules/options/my.nix),
      # not in specialArgs.
      mkDarwin =
        hostname:
        nix-darwin.lib.darwinSystem {
          modules = [
            (./hosts + "/${hostname}")

            ./modules/options
            {
              my = {
                inherit username hostname;
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

            home-manager.darwinModules.home-manager
            (_: {
              users.users.${username}.home = "/Users/${username}";
              home-manager = {
                useGlobalPkgs = true;
                useUserPackages = true;
                backupFileExtension = "backup";
                # Preserve the latest pre-managed file without failing when a
                # previous activation already created the fixed-name backup.
                overwriteBackup = true;
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
      overlays.default =
        final: _previous:
        import ./pkgs {
          pkgs = final;
          inherit
            bun2nix
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
        audit-probes-check = auditProbesCheck;
        github-sources-check = githubSourcesCheck;
        system-setup-manifest-personal = systemSetupManifestCheck "popemkt-personal";
        system-setup-manifest-work = systemSetupManifestCheck "popemkt-work";
        darwin-personal = self.darwinConfigurations.popemkt-personal.system;
        darwin-work = self.darwinConfigurations.popemkt-work.system;
      };

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
