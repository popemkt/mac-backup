{
  config,
  lib,
  pkgs,
  ...
}:

# The dashboard component: Beszel (nixpkgs' services.beszel.{hub,agent}),
# read-only, on the tailnet only (docs/monitoring.md → Dashboard).
#
#   tailscaled (svc:<service>, HTTPS) → /run/beszel-hub-proxy/beszel.sock
#   (root-only) → systemd-socket-proxyd → 127.0.0.1:<port> in the hub's own
#   network namespace → beszel-hub ─ SSH over /run/beszel-agent/beszel.sock →
#   beszel-agent (host network, reads the machine)
#
# Who is viewing: the hub trusts the `Tailscale-User-Login` header, which
# tailscaled sets from the caller's identity and strips from requests, as
# Marginalia does (docs/marginalia-service.md). That is only safe if nothing
# else can send the hub a request: the hub runs in a network namespace of its
# own (PrivateNetwork=), which only its proxy joins, and the proxy's socket
# is root's alone (0600 in a 0700 directory), so no other account on the
# host, nor any other process, can reach the hub's port and forge the
# header. Password sign-in is off; the hub's one user is `login`, created on
# its first start (USER_EMAIL, with a random password nobody uses).
# Beszel's own alerting has no way out (no network) and is not used; alerts
# are ./alerts.nix's.
let
  cfg = config.my.stacks.monitoring;
  inherit (cfg) dashboard;
  hub = config.services.beszel.hub;
  proxyDir = "/run/beszel-hub-proxy";
  proxySocket = "${proxyDir}/beszel.sock";
  agentSocket = "/run/beszel-agent/beszel.sock";
  # The hub's public key, which the agent accepts, in the hub's runtime
  # directory: the agent (a DynamicUser= unit) cannot see the hub's state.
  hubPublicKey = "/run/beszel-hub/hub.pub";
  bootstrapEnv = "/run/beszel-hub-bootstrap/env";
  # The hub's data, in its working directory (PocketBase's default
  # `beszel_data`): the database, its SSH key, and config.yml.
  hubData = "${hub.dataDir}/beszel_data";

  # The one system the hub watches, this host, through the agent's socket,
  # shown to the one user (Beszel's config.yml, applied on each start).
  configYml = (pkgs.formats.yaml { }).generate "beszel-config.yml" {
    systems = [
      {
        name = config.my.hostname;
        host = agentSocket;
        users = [ dashboard.login ];
      }
    ];
  };
in
lib.mkIf (cfg.enable && dashboard.enable) {
  services.beszel.hub = {
    enable = true;
    host = "127.0.0.1";
    inherit (dashboard) port;
    environment = {
      TRUSTED_AUTH_HEADER = "Tailscale-User-Login";
      # The proxy, the only peer in the namespace.
      TRUSTED_PROXY_IPS = "127.0.0.1";
      DISABLE_PASSWORD_AUTH = "true";
      # Read only by the first start's migration, which creates the user.
      USER_EMAIL = dashboard.login;
    };
    environmentFile = bootstrapEnv;
  };

  # USER_PASSWORD for that migration: Beszel creates the user only when
  # given both. Random each start, never stored, never used to sign in.
  systemd.services.beszel-hub-bootstrap = {
    description = "Beszel hub first-start password (unused; password sign-in is off)";
    before = [ "beszel-hub.service" ];
    requiredBy = [ "beszel-hub.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      RuntimeDirectory = "beszel-hub-bootstrap";
      RuntimeDirectoryMode = "0700";
      UMask = "0077";
    };
    script = ''
      printf 'USER_PASSWORD=%s\n' "$(${pkgs.openssl}/bin/openssl rand -hex 24)" > ${bootstrapEnv}
    '';
  };

  systemd.services.beszel-hub = {
    serviceConfig = {
      PrivateNetwork = true;
      # To open the agent's socket.
      SupplementaryGroups = [ "beszel-agent" ];
      ExecStartPre = lib.mkAfter [
        "${pkgs.coreutils}/bin/install -m 0640 ${configYml} ${hubData}/config.yml"
        # The hub's SSH key pair, made here rather than on its first
        # connection, so the agent can be given the public key before then.
        "${pkgs.writeShellScript "beszel-hub-key" ''
          set -eu
          [ -s ${hubData}/id_ed25519 ] ||
            ${pkgs.openssh}/bin/ssh-keygen -q -t ed25519 -N "" -C beszel-hub -f ${hubData}/id_ed25519
          ${pkgs.openssh}/bin/ssh-keygen -y -f ${hubData}/id_ed25519 > ${hubPublicKey}.new
          ${pkgs.coreutils}/bin/chmod 0644 ${hubPublicKey}.new
          ${pkgs.coreutils}/bin/mv ${hubPublicKey}.new ${hubPublicKey}
        ''}"
      ];
    };
  };

  systemd.sockets.beszel-hub-proxy = {
    description = "Beszel hub's socket, for tailscaled";
    wantedBy = [ "sockets.target" ];
    listenStreams = [ proxySocket ];
    socketConfig = {
      SocketUser = "root";
      SocketMode = "0600";
      DirectoryMode = "0700";
    };
  };
  systemd.services.beszel-hub-proxy = {
    description = "Relay the Beszel hub's socket into its network namespace";
    requires = [ "beszel-hub.service" ];
    bindsTo = [ "beszel-hub.service" ];
    after = [ "beszel-hub.service" ];
    unitConfig.JoinsNamespaceOf = "beszel-hub.service";
    serviceConfig = {
      ExecStart = "${config.systemd.package}/lib/systemd/systemd-socket-proxyd --exit-idle-time=5min 127.0.0.1:${toString dashboard.port}";
      PrivateNetwork = true;
      DynamicUser = true;
      PrivateTmp = true;
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
    };
  };

  services.beszel.agent = {
    enable = true;
    environment = {
      LISTEN = agentSocket;
      KEY_FILE = hubPublicKey;
    };
  };
  systemd.services.beszel-agent = {
    wants = [ "beszel-hub.service" ];
    after = [ "beszel-hub.service" ];
    # Started after the hub has published its key; a hub that restarts
    # (perhaps with a new key) restarts the agent, which reads it again.
    partOf = [ "beszel-hub.service" ];
    serviceConfig = {
      RuntimeDirectory = "beszel-agent";
      RuntimeDirectoryMode = "0750";
      # The socket group-writable, for the hub.
      UMask = lib.mkForce "0007";
    };
  };

  my.stacks.vpn.services.${dashboard.service}.target = "unix:${proxySocket}";
}
