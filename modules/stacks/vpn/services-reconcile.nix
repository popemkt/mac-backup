{
  lib,
  pkgs,
  cfg,
  tailscale,
  stateDir,
}:

# The Tailscale Services reconcile, and the declared node-level serve entries
# (`nodeServe`) with it, shared by every platform. The platform
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

  # Node-level entries (https://<host>[:port]), by HTTPS port.
  nodePorts = map (entry: toString entry.port) (builtins.attrValues cfg.nodeServe);
  nodePortsFile = pkgs.writeText "tailscale-managed-node-ports" (
    concatStringsSep "\n" nodePorts + optionalString (nodePorts != [ ]) "\n"
  );
  # One mount per path, each to `<target><path>`: tailscaled strips the
  # mount from the request path before proxying, and this puts it back.
  # `funnel` sets the same mounts with Funnel on.
  configureNodeServe = concatStringsSep "\n" (
    lib.concatLists (
      mapAttrsToList (
        _: entry:
        map (
          path:
          let
            command = if entry.funnel then "funnel" else "serve";
          in
          if path == "/" then
            "${tailscale} ${command} --bg --yes --https=${toString entry.port} ${escapeShellArg entry.target}"
          else
            "${tailscale} ${command} --bg --yes --https=${toString entry.port} --set-path=${escapeShellArg path} ${
              escapeShellArg (entry.target + path)
            }"
        ) entry.paths
      ) cfg.nodeServe
    )
  );
  funnelPorts = lib.unique (
    map (entry: toString entry.port) (
      lib.filter (entry: entry.funnel) (builtins.attrValues cfg.nodeServe)
    )
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
  enable = cfg.enable && (cfg.services != { } || cfg.nodeServe != { });

  assertions = [
    {
      assertion = builtins.all validName serviceNames;
      message = "Tailscale Service names may contain only lowercase letters, digits, and hyphens.";
    }
    {
      assertion = builtins.all (entry: localTarget entry.target) (
        builtins.attrValues cfg.services ++ builtins.attrValues cfg.nodeServe
      );
      message = "Tailscale Service and nodeServe targets must be a loopback http, https, or tcp address, or unix:/absolute/socket/path.";
    }
    {
      assertion = lib.length nodePorts == lib.length (lib.unique nodePorts);
      message = "my.stacks.vpn.nodeServe entries must each use their own HTTPS port.";
    }
    {
      assertion = builtins.all (
        port:
        builtins.elem port [
          "443"
          "8443"
          "10000"
        ]
      ) funnelPorts;
      message = "my.stacks.vpn.nodeServe: Funnel serves only HTTPS ports 443, 8443 and 10000.";
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

    # Node-level entries: drop the ones this job set last time, then set the
    # declared ones (an entry serves every path of its port).
    managed_node_ports="$state_dir/managed-node-ports"
    if [ -f "$managed_node_ports" ]; then
      while IFS= read -r port; do
        [ -z "$port" ] || ${tailscale} serve --https="$port" off || true
      done < "$managed_node_ports"
    fi

    # Funnel: on only where declared. Dropping the ports set last time
    # already took their Funnel down; any other port with Funnel on (set by
    # hand, or left by an older declaration) goes down here, before the
    # declared entries are set. Not `funnel reset`: that clears the node's
    # whole serve config, Services and adhoc shares included.
    if ! serve_status=$(${tailscale} serve status --json); then
      echo "tailscale serve status failed: cannot check which ports have Funnel on" >&2
      exit 1
    fi
    funnel_on=$(printf '%s' "$serve_status" | ${pkgs.jq}/bin/jq -r '.AllowFunnel // {} | keys[]')
    for host_port in $funnel_on; do
      case " ${concatStringsSep " " funnelPorts} " in
        *" ''${host_port##*:} "*) ;;
        *) ${tailscale} funnel --https="''${host_port##*:}" off ;;
      esac
    done

    ${configureNodeServe}


    ${pkgs.coreutils}/bin/install -m 0600 ${nodePortsFile} "$managed_node_ports.new"
    ${pkgs.coreutils}/bin/mv "$managed_node_ports.new" "$managed_node_ports"

    ${pkgs.coreutils}/bin/install -m 0600 ${serviceNamesFile} "$managed_services.new"
    ${pkgs.coreutils}/bin/mv "$managed_services.new" "$managed_services"
  '';
}
