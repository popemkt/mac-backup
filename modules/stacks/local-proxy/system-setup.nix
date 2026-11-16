{ config, lib, ... }:

# Readiness of the local proxy: its daemon runs the declared command and is
# the one listener on loopback :443 (IPv4 and IPv6, never the wildcard), Time
# Machine excludes its CA state, and the person's macOS trust settings trust
# its root CA. Each site's own
# readiness belongs to the app it serves, which checks its address over HTTPS
# through the OS trust store (http_json), as a browser would; a host makes
# that check depend on `local-proxy-trust`.
let
  cfg = config.my.stacks.local-proxy;
  daemon = config.launchd.daemons.local-proxy.serviceConfig;
  inherit (config.users.users.${config.my.username}) home;
  origins = map (site: site.origin) (lib.attrValues cfg.sites);
  inherit (cfg) stateDir;
  connections = [
    {
      source = "local-host";
      target = "local-proxy";
    }
  ];
in
{
  config = lib.mkIf cfg.enable {
    my.systemSetup = {
      components.local-proxy = {
        name = "Local HTTPS proxy";
        description = "Caddy as a root LaunchDaemon on loopback :443, serving each declared *.localhost site under this machine's own CA.";
        managedBy = "nix";
      };

      integrations.local-proxy-process = {
        name = "Local proxy listener";
        description = "The declared LaunchDaemon alone listens on 127.0.0.1:443 and [::1]:443.";
        requiredBy = origins;
        inherit connections;
        check = {
          kind = "launchd_listener";
          domain = "system";
          label = daemon.Label;
          expected_argv = daemon.ProgramArguments;
          port = 443;
          addresses = [
            "127.0.0.1"
            "::1"
          ];
        };
        enrollment = {
          kind = "none";
          instructions = "Rebuild installs and starts the daemon. If another process holds port 443 on loopback, stop it.";
        };
        statePaths = [ ];
        secretPolicy = "The daemon holds no secret beyond the CA state under ${stateDir}.";
        recovery = "Rebuild, then inspect /var/log/local-proxy.log and `sudo launchctl print system/${daemon.Label}`.";
      };

      integrations.local-proxy-backup-exclusion = {
        dependsOn = [ "local-proxy-process" ];
        name = "Local proxy CA kept out of backups";
        description = "Time Machine excludes the CA state directory, which the daemon marks before it makes the CA.";
        inherit connections;
        check = {
          kind = "command";
          argv = [
            "/usr/bin/tmutil"
            "isexcluded"
            stateDir
          ];
          stdout_contains = [ "[Excluded]" ];
          report_stdout = false;
          success_detail = "Time Machine excludes ${stateDir}";
        };
        enrollment = {
          kind = "none";
          instructions = "The daemon marks ${stateDir} excluded on every start; restart it (rebuild) if this fails, and see /var/log/local-proxy.log.";
        };
        statePaths = [ stateDir ];
        secretPolicy = "Excluding the CA key from backups keeps it from leaving this Mac.";
        recovery = "Rebuild, or run `sudo tmutil addexclusion ${stateDir}`.";
      };

      integrations.local-proxy-trust = {
        dependsOn = [ "local-proxy-process" ];
        name = "Local proxy CA trust";
        description = "This user's macOS trust settings trust the local proxy's root CA, so browsers accept every *.localhost site it serves.";
        requiredBy = origins;
        inherit connections;
        check = {
          kind = "command";
          argv = [
            "/usr/bin/security"
            "verify-cert"
            "-c"
            cfg.caCertificate
            "-p"
            "basic"
            "-L"
            "-n"
          ];
          report_stdout = false;
          success_detail = "macOS trusts ${cfg.caCertificate}";
        };
        enrollment = {
          kind = "command";
          instructions = ''
            Trust the local proxy's root CA in your login keychain's trust settings.
            macOS asks for your password to change trust settings. The CA vouches only for
            DNS names under localhost (never an IP address), and its key stays root-only. A new CA
            (after its key is lost or it nears expiry) needs this again.
          '';
          argv = [
            "/usr/bin/security"
            "add-trusted-cert"
            "-r"
            "trustRoot"
            "-k"
            "${home}/Library/Keychains/login.keychain-db"
            cfg.caCertificate
          ];
        };
        statePaths = [ stateDir ];
        secretPolicy = "The CA key stays root-only under ${stateDir}/ca/private, outside Git and the Nix store; Time Machine excludes it (local-proxy-backup-exclusion).";
        recovery = "Rebuild (the daemon recreates a missing CA), re-run the enrollment, and inspect /var/log/local-proxy.log.";
      };
    };
  };
}
