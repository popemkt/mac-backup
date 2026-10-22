{
  lib,
  pkgs,
  cfg,
  tailscale,
  stateDir,
}:

# The Tailscale Services reconcile, shared by every platform. The platform
# modules (./darwin.nix, ./nixos.nix) supply the `tailscale` binary and the
# state directory, and run `script` under their own service manager.
let
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
        ${tailscale} serve --yes \
          --service=${escapeShellArg serviceName} \
          --${service.protocol}=${toString service.port} \
          ${escapeShellArg service.target}
        ${optionalString (!service.advertised) "${tailscale} serve drain ${escapeShellArg serviceName}"}
      ''
    ) cfg.services
  );

  validName = name: builtins.match "[a-z0-9][a-z0-9-]*" name != null;
  # A target stays on this host: a loopback http, https, or tcp address, or a
  # Unix socket (`unix:/abs/path`), which tailscaled, as root, proxies HTTP to.
  localTarget =
    target:
    builtins.match "(http|https|tcp)://(127\\.0\\.0\\.1|localhost):[0-9]+(/.*)?" target != null
    || builtins.match "unix:/[^[:space:]]+" target != null;
in
{
  # Only reconcile when the stack is on AND services are declared; enabling
  # vpn for just the client leaves no service job behind.
  enable = cfg.enable && cfg.services != { };

  assertions = [
    {
      assertion = builtins.all validName serviceNames;
      message = "Tailscale Service names may contain only lowercase letters, digits, and hyphens.";
    }
    {
      assertion = builtins.all (service: localTarget service.target) (builtins.attrValues cfg.services);
      message = "Tailscale Service targets must be a loopback http, https, or tcp address, or unix:/absolute/socket/path.";
    }
  ];

  script = ''
    set -eu

    ${tailscale} wait --timeout=2m

    state_dir=${stateDir}
    managed_services="$state_dir/managed-services"
    ${pkgs.coreutils}/bin/mkdir -p "$state_dir"

    if [ -f "$managed_services" ]; then
      while IFS= read -r service_name; do
        [ -z "$service_name" ] || ${tailscale} serve clear "$service_name" || true
      done < "$managed_services"
    fi

    ${configureServices}

    ${pkgs.coreutils}/bin/install -m 0600 ${serviceNamesFile} "$managed_services.new"
    ${pkgs.coreutils}/bin/mv "$managed_services.new" "$managed_services"
  '';
}
