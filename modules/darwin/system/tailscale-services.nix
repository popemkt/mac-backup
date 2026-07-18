{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.my.tailscaleServices;
  inherit (lib)
    concatStringsSep
    escapeShellArg
    mapAttrsToList
    optionalString
    ;

  serviceNames = builtins.attrNames cfg.services;
  serviceNamesFile = pkgs.writeText "tailscale-managed-services" (
    concatStringsSep "\n" (map (name: "svc:${name}") serviceNames)
    + optionalString (serviceNames != [ ]) "\n"
  );

  configureServices = concatStringsSep "\n" (
    mapAttrsToList (
      name: service:
      let
        serviceName = "svc:${name}";
      in
      ''
        /usr/local/bin/tailscale serve --yes \
          --service=${escapeShellArg serviceName} \
          --${service.protocol}=${toString service.port} \
          ${escapeShellArg service.target}
        ${optionalString (
          !service.advertised
        ) "/usr/local/bin/tailscale serve drain ${escapeShellArg serviceName}"}
      ''
    ) cfg.services
  );

  validName = name: builtins.match "[a-z0-9][a-z0-9-]*" name != null;
  loopbackTarget =
    target: builtins.match "(http|https|tcp)://(127\\.0\\.0\\.1|localhost):[0-9]+(/.*)?" target != null;
in
{
  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = builtins.all validName serviceNames;
        message = "Tailscale Service names may contain only lowercase letters, digits, and hyphens.";
      }
      {
        assertion = builtins.all (service: loopbackTarget service.target) (
          builtins.attrValues cfg.services
        );
        message = "Tailscale Service targets must use http, https, or tcp and a loopback address.";
      }
    ];

    launchd.daemons.tailscale-services = {
      script = ''
        set -eu

        /usr/local/bin/tailscale wait --timeout=2m

        state_dir=/var/db/tailscale-services
        managed_services="$state_dir/managed-services"
        ${pkgs.coreutils}/bin/mkdir -p "$state_dir"

        if [ -f "$managed_services" ]; then
          while IFS= read -r service_name; do
            [ -z "$service_name" ] || /usr/local/bin/tailscale serve clear "$service_name" || true
          done < "$managed_services"
        fi

        ${configureServices}

        ${pkgs.coreutils}/bin/install -m 0600 ${serviceNamesFile} "$managed_services.new"
        ${pkgs.coreutils}/bin/mv "$managed_services.new" "$managed_services"
      '';
      serviceConfig = {
        RunAtLoad = true;
        KeepAlive.SuccessfulExit = false;
        ThrottleInterval = 30;
        StandardOutPath = "/var/log/tailscale-services.log";
        StandardErrorPath = "/var/log/tailscale-services.log";
      };
    };
  };
}
