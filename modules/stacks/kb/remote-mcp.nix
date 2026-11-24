{
  config,
  lib,
  pkgs,
  ...
}:

# A kb store's MCP behind the OAuth edge (`remoteMcp` on one store;
# my.stacks.mcp-edge holds the edge, docs/mcp-edge.md). The unit `kb-remote`
# runs `kb --root <store> mcp --listen unix:/run/kb-edge/mcp.sock`, with
# KB_VIA=mcp-remote so kb records where each write came from; kb itself
# knows nothing of access.
#
# Identity (B1): it runs as `kb-edge`, never as the store's owner, so the
# owner's own processes cannot open its socket. The store is shared through
# ACLs instead (`kb-remote-store-acl`): kb-edge's group and the owner each get
# read-write, with defaults, so a file either side writes, or atomically
# replaces, stays writable by the other.
#
# Sandbox (B2): an allow-list, not a deny-list. The unit's root is an empty
# read-only tmpfs; into it go the Nix store (read-only), the store's root and
# the socket's directory (read-write), its own state (KB_DATA) and the kernel
# API filesystems; no network, no IPC, AF_UNIX only, no capabilities. The
# same attribute set defines `kb-remote-sandbox-check`, which probes those
# restrictions from inside and which kb-remote requires: it never starts in
# a sandbox that leaks.
let
  inherit (config.my.stacks) kb;
  edge = config.my.stacks.mcp-edge;
  remote = lib.filterAttrs (_: store: store.remoteMcp.enable) kb.stores;
  name = lib.head (lib.attrNames remote);
  store = remote.${name};
  stateDir = "/var/lib/kb-remote";
  socketDir = dirOf edge.socket;

  # The paths the unit sees, and so `/` lists: the binds' top directories and
  # the API filesystems systemd mounts (/dev, /proc, /sys).
  readOnly = [ "/nix/store" ];
  readWrite = [
    store.root
    socketDir
    stateDir
  ];
  topOf = path: lib.head (lib.splitString "/" (lib.removePrefix "/" path));
  rootListing = lib.concatStringsSep " " (
    lib.sort lib.lessThan (
      lib.unique (
        map topOf (readOnly ++ readWrite)
        ++ [
          "dev"
          "proc"
          "sys"
        ]
      )
    )
  );
  # What must not be there: every other socket directory my.services
  # creates (other stores' UIs and capture listeners, bb, …), tailscaled's,
  # D-Bus, people's runtime directories, /etc and /root.
  absent = lib.unique (
    lib.filter (dir: dir != socketDir) (
      map (app: dirOf app.socket) (
        lib.filter (app: app.socket != null) (lib.attrValues config.my.services)
      )
    )
    ++ [
      "/run/tailscale"
      "/run/dbus"
      "/run/user"
      "/run/postgresql"
      "/etc"
      "/root"
    ]
  );

  sandbox = {
    environment = {
      KB_VIA = "mcp-remote";
      KB_DATA = stateDir;
      HOME = stateDir;
      TMPDIR = stateDir;
    };
    serviceConfig = {
      User = edge.user;
      Group = edge.user;
      UMask = "0007";
      StateDirectory = baseNameOf stateDir;
      StateDirectoryMode = "0700";

      TemporaryFileSystem = "/:ro";
      MountAPIVFS = true;
      BindReadOnlyPaths = readOnly;
      BindPaths = readWrite;

      PrivateNetwork = true;
      PrivateIPC = true;
      PrivateDevices = true;
      PrivateUsers = false;
      RestrictAddressFamilies = [ "AF_UNIX" ];
      CapabilityBoundingSet = "";
      AmbientCapabilities = "";
      NoNewPrivileges = true;
      ProtectProc = "invisible";
      ProcSubset = "pid";
      ProtectKernelTunables = true;
      ProtectKernelModules = true;
      ProtectKernelLogs = true;
      ProtectControlGroups = true;
      ProtectClock = true;
      ProtectHostname = true;
      RestrictNamespaces = true;
      RestrictRealtime = true;
      RestrictSUIDSGID = true;
      LockPersonality = true;
      SystemCallArchitectures = "native";
      SystemCallFilter = [
        "@system-service"
        "~@privileged"
      ];
      # Load stays bounded on a store app-kb shares (threat 8).
      MemoryMax = "1G";
      CPUQuota = "100%";
      TasksMax = 128;
    };
  };

  probe = pkgs.writeShellApplication {
    name = "kb-remote-sandbox-check";
    runtimeInputs = [
      pkgs.coreutils
      pkgs.findutils
      pkgs.python3
    ];
    runtimeEnv = {
      ROOT_LISTING = rootListing;
      ABSENT = lib.concatStringsSep " " absent;
      STORE = store.root;
      STATE = stateDir;
      SOCKET_DIR = socketDir;
    };
    text = builtins.readFile ./remote-mcp-sandbox-check.sh;
  };
in
{
  config = lib.mkIf (kb.enable && remote != { }) {
    assertions = [
      {
        assertion = lib.length (lib.attrNames remote) == 1;
        message = "my.stacks.kb.stores: remoteMcp is on for ${toString (lib.attrNames remote)}; the edge serves one store.";
      }
      {
        assertion = edge.enable;
        message = "my.stacks.kb.stores.${name}.remoteMcp needs my.stacks.mcp-edge.enable.";
      }
      {
        assertion = store.remoteMcp.emails != [ ];
        message = "my.stacks.kb.stores.${name}.remoteMcp.emails is empty: nobody could use it.";
      }
    ];

    my.stacks.mcp-edge.resource.allowedEmails = store.remoteMcp.emails;

    systemd.services = {
      # B1: the owner and kb-edge both read and write the store, and what
      # either creates inherits the same.
      kb-remote-store-acl = {
        description = "Share kb store ${name} with kb-edge (ACLs)";
        after = [ "app-${name}.service" ];
        path = [ pkgs.acl ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
        };
        script = ''
          set -eu
          root=${lib.escapeShellArg store.root}
          # app-${name} creates the root on its very first start.
          for _ in $(seq 120); do
            [ -d "$root" ] && break
            sleep 1
          done
          if [ ! -d "$root" ]; then
            echo "store root $root does not exist: app-${name} creates it on its first start" >&2
            exit 1
          fi
          # Each entry twice: on what exists, and as a default for what
          # either side creates later.
          setfacl -R -m "g:${edge.user}:rwX,u:${store.owner}:rwX,d:g:${edge.user}:rwX,d:u:${store.owner}:rwX" "$root"
        '';
      };

      kb-remote-sandbox-check = lib.recursiveUpdate sandbox {
        description = "Probe kb-remote's sandbox from inside it";
        requires = [ "kb-remote-store-acl.service" ];
        after = [ "kb-remote-store-acl.service" ];
        serviceConfig = {
          Type = "oneshot";
          ExecStart = lib.getExe probe;
        };
      };

      kb-remote = lib.recursiveUpdate sandbox {
        description = "kb's MCP on store ${name}, for the OAuth edge";
        wantedBy = [ "multi-user.target" ];
        requires = [
          "kb-remote-store-acl.service"
          "kb-remote-sandbox-check.service"
        ];
        after = [
          "kb-remote-store-acl.service"
          "kb-remote-sandbox-check.service"
        ];
        serviceConfig = {
          ExecStart = lib.escapeShellArgs [
            (lib.getExe store.remoteMcp.package)
            "--root"
            store.root
            "mcp"
            "--listen"
            "unix:${edge.socket}"
          ];
          Restart = "on-failure";
          RestartSec = 5;
        };
      };
    };
  };
}
