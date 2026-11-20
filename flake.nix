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
              "antigravity-cli"
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
      # The local packages this system can build: shared-server's apps
      # (axioms, spacetimedb, marginalia) are Linux-only, built where they run.
      systemPackages = nixpkgs.lib.filterAttrs (
        _: nixpkgs.lib.meta.availableOn pkgs.stdenv.hostPlatform
      ) localPackages;

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

      # The app and its fixture tests share the same wrapper; the tests
      # supply stubs for nvfetcher and gh.
      # The script runs under the app's own bash, never whatever `env bash`
      # finds: on a minimal PATH that is macOS's /bin/bash 3.2.
      mkGithubSources =
        pkgs: nvfetcher: gh:
        pkgs.writeShellApplication {
          name = "github-sources";
          runtimeInputs = with pkgs; [
            coreutils
            curl
            diffutils
            gh
            git
            jq
            nvfetcher
            openssl
            remarshal
          ];
          text = ''
            exec ${pkgs.lib.getExe pkgs.bash} ${./scripts/github-sources} "$@"
          '';
        };

      pinToolsCheck =
        pkgs:
        let
          nvfetcherStub = pkgs.writeShellScriptBin "nvfetcher" (
            builtins.readFile ./scripts/tests/nvfetcher-stub.sh
          );
          ghStub = pkgs.writeShellScriptBin "gh" (builtins.readFile ./scripts/tests/gh-attestation-stub.sh);
          app = mkGithubSources pkgs nvfetcherStub ghStub;
        in
        pkgs.runCommand "pin-tools-check"
          {
            nativeBuildInputs = with pkgs; [
              bash
              coreutils
              diffutils
              git
              gnugrep
              jq
            ];
          }
          ''
            bash ${./scripts/tests/pin-tools-check.sh}               ${app}/bin/github-sources ${./scripts/uv-sources}               ${pkgs.python3}/bin ${./scripts/tests/pypi-stub}
            bash ${./scripts/tests/github-sources-check.sh}               ${app}/bin/github-sources ${./scripts/github-sources}
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

      # Unit tests of canvas-link's rules (modules/stacks/ai-agents/canvas-links).
      canvasLinksCheck =
        pkgs.runCommand "canvas-links-check"
          {
            nativeBuildInputs = [ pkgs.nodejs ];
          }
          ''
            cd ${./modules/stacks/ai-agents/canvas-links/cli}
            node --test tests/*.test.mjs
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
              # popemkt's endpoint for temporary apps, on shared-server: what
              # `adhoc --shared` forwards to, read from that host's own
              # declaration so the two cannot drift.
              sharedAdhoc =
                let
                  host = "shared-server";
                  service = self.nixosConfigurations.${host}.config.my.stacks.vpn.services.adhoc-popemkt;
                in
                {
                  inherit host;
                  origin = service.publicOrigin;
                  inherit (service) target;
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
      executorContractCheck =
        pkgs:
        import ./modules/options/package-executors-check.nix {
          inherit pkgs;
          inherit (self) darwinConfigurations nixosConfigurations;
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

      packages.${system} = systemPackages // {
        default = localPackages.cli-proxy-api;
      };

      checks.${system} = systemPackages // {
        inherit systemSetupCheck;
        package-executors-contract = executorContractCheck pkgs;
        npm-global-activation-check = import ./modules/common/home-manager/npm-global-test.nix {
          inherit pkgs;
        };
        reconcile-scripts-check = reconcileScriptsCheck;
        audit-lib-check = auditLibCheck;
        # my.services' restart scripts, built as the NixOS module builds
        # them and run against a fake systemctl.
        app-restart-check = import ./modules/nixos/system/app-restart/tests.nix { inherit pkgs; };
        canvas-links-check = canvasLinksCheck;
        # Each plugin's store copy, bb's and the agents', holds every
        # relative path its source reaches
        # (modules/common/home-manager/plugin-sources/source.nix).
        plugin-sources-check = import ./modules/common/home-manager/plugin-sources/check.nix {
          inherit pkgs;
          inherit (pkgs) lib;
        };
        # agent-plugins-sync and the agent-plugins activation, run against
        # fake claude, codex and omp.
        agent-plugins-check = import ./modules/common/home-manager/agent-plugins/tests.nix {
          inherit pkgs;
        };
        # mcp-servers-sync, run against fake claude and codex and the
        # harnesses configured by a JSON file.
        mcp-servers-check = import ./modules/common/home-manager/mcp-servers/tests.nix {
          inherit pkgs;
        };
        # The local proxy's CA script and Caddy configuration, run on a high
        # port in front of a test app.
        local-proxy-check = import ./modules/stacks/local-proxy/tests.nix { inherit pkgs; };
        pin-tools-check = pinToolsCheck pkgs;
        system-setup-manifest-personal = systemSetupManifestCheck "popemkt-personal";
        system-setup-manifest-work = systemSetupManifestCheck "popemkt-work";
        darwin-personal = self.darwinConfigurations.popemkt-personal.system;
        darwin-work = self.darwinConfigurations.popemkt-work.system;
      };

      checks.x86_64-linux.package-executors-contract = executorContractCheck (pkgsFor "x86_64-linux");

      checks.x86_64-linux.npm-global-activation-check =
        import ./modules/common/home-manager/npm-global-test.nix
          {
            pkgs = pkgsFor "x86_64-linux";
          };

      checks.x86_64-linux.pin-tools-check = pinToolsCheck (pkgsFor "x86_64-linux");

      checks.x86_64-linux.mcp-servers-check = import ./modules/common/home-manager/mcp-servers/tests.nix {
        pkgs = pkgsFor "x86_64-linux";
      };

      # The same local-proxy check on Linux, minus macOS's own verifier, so
      # the CA script and Caddy configuration can be exercised off a Mac.
      checks.x86_64-linux.local-proxy-check = import ./modules/stacks/local-proxy/tests.nix {
        pkgs = pkgsFor "x86_64-linux";
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
            program = "${mkGithubSources pkgs pkgs.nvfetcher pkgs.gh}/bin/github-sources";
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
              hujsonfmt
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

      # Every Tailscale Service any host declares, as plain data: one entry
      # per (service, host), since more than one host may advertise a
      # Service. It is what tooling outside Nix reads, so a Service is
      # declared once, in its host's my.stacks.vpn.services.
      tailscaleServices =
        let
          hostServices =
            hostname: configuration:
            let
              vpn = configuration.config.my.stacks.vpn;
            in
            nixpkgs.lib.optionals vpn.enable (
              nixpkgs.lib.mapAttrsToList (name: service: {
                name = "svc:${name}";
                host = hostname;
                inherit (service) port protocol;
                inherit (vpn) tags;
              }) vpn.services
            );
        in
        nixpkgs.lib.concatLists (
          nixpkgs.lib.mapAttrsToList hostServices (self.darwinConfigurations // self.nixosConfigurations)
        );
    };
}
