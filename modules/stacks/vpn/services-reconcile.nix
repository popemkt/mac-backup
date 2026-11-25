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
  nodeEntries = builtins.attrValues cfg.nodeServe;
  nodePorts = map (entry: toString entry.port) nodeEntries;
  funnelPorts = lib.unique (
    map (entry: toString entry.port) (lib.filter (entry: entry.funnel) nodeEntries)
  );
  # One mount per path, each to `<target><path>`: tailscaled strips the
  # mount from the request path before proxying, and this puts it back.
  mountTarget = entry: path: if path == "/" then entry.target else entry.target + path;
  # What tailscaled reports for an entry's port when it serves exactly the
  # entry (`port_mounts` below): one "<path> <proxy>" line per mount.
  expectedMounts =
    entry:
    pkgs.writeText "tailscale-node-mounts-${toString entry.port}" (
      concatStringsSep "" (map (path: "${path} ${mountTarget entry path}\n") entry.paths)
    );
  setMounts =
    command: entry:
    concatStringsSep "\n" (
      map (
        path:
        "${tailscale} ${command} --bg --yes --https=${toString entry.port}"
        + optionalString (path != "/") " --set-path=${escapeShellArg path}"
        + " ${escapeShellArg (mountTarget entry path)}"
      ) entry.paths
    );

  # Each declared entry: take its port only when nothing is served there,
  # record it as this job's before setting anything, set the mounts on the
  # tailnet, and turn Funnel on only once the port serves exactly them.
  configureNodeServe = concatStringsSep "\n" (
    map (
      entry:
      let
        port = toString entry.port;
        expected = expectedMounts entry;
      in
      ''
        read_status
        if port_taken ${port}; then
          refuse_port ${port}
        else
          echo ${port} >> "$managed_node_ports"
          ${setMounts "serve" entry}
          ${optionalString entry.funnel ''
            read_status
            if port_exact ${port} ${expected}; then
              ${setMounts "funnel" entry}
              read_status
              if ! port_exact ${port} ${expected}; then
                echo "tailscale-services: HTTPS port ${port} changed while Funnel came on; taking it down" >&2
                ${tailscale} serve --yes --https=${port} off
                failed=1
              fi
            else
              echo "tailscale-services: HTTPS port ${port} does not serve exactly its declared mounts; not turning Funnel on. It serves:" >&2
              port_mounts ${port} | ${sed} 's/^/  /' >&2
              ${tailscale} serve --yes --https=${port} off
              failed=1
            fi
          ''}
        fi
      ''
    ) nodeEntries
  );
  # A port this job manages keeps Funnel only when it is declared with
  # Funnel and serves exactly the declared mounts.
  keepsFunnel = concatStringsSep "\n" (
    map (
      entry: "${toString entry.port}) port_exact ${toString entry.port} ${expectedMounts entry} ;;"
    ) (lib.filter (entry: entry.funnel) nodeEntries)
  );

  # Reading the node's serve config, shared by the reconcile and the drift
  # check (`driftScript`): one meaning for "port P serves exactly its
  # declared mounts".
  statusLib = ''
    # The node's serve config (`tailscale serve status --json`); Services sit
    # under .Services, so .Web, .TCP and .AllowFunnel are node-level only.
    read_status() {
      if ! status=$(${tailscale} serve status --json) \
        || ! printf '%s' "$status" | ${jq} -e 'type == "object"' > /dev/null; then
        echo "tailscale-services: tailscale serve status failed; changing nothing more" >&2
        exit "''${read_status_exit:-1}"
      fi
    }
    # "<path> <proxy>" per mount on HTTPS port $1, sorted; a mount that is
    # not a plain proxy shows as its JSON.
    port_mounts() {
      printf '%s' "$status" | ${jq} -r --arg port "$1" '
        .Web // {} | to_entries[] | select(.key | endswith(":" + $port))
        | .value.Handlers // {} | to_entries[]
        | "\(.key) \(if (.value | keys) == ["Proxy"] then .value.Proxy else (.value | tojson) end)"' \
        | ${sort}
    }
    port_listener() {
      printf '%s' "$status" | ${jq} -c --arg port "$1" '.TCP // {} | .[$port] // empty'
    }
    port_taken() {
      [ -n "$(port_listener "$1")" ] || [ -n "$(port_mounts "$1")" ]
    }
    # Port $1 serves HTTPS with exactly the mounts listed in file $2.
    port_exact() {
      [ "$(port_listener "$1")" = '{"HTTPS":true}' ] \
        && [ "$(port_mounts "$1")" = "$(${sort} "$2")" ]
    }
    funnel_ports() {
      printf '%s' "$status" | ${jq} -r '.AllowFunnel // {} | to_entries[] | select(.value) | .key | sub(".*:"; "")'
    }
  '';

  jq = "${pkgs.jq}/bin/jq";
  sed = "${pkgs.gnused}/bin/sed";
  sort = "LC_ALL=C ${pkgs.coreutils}/bin/sort";

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

  # The drift check (the monitoring stack's alert): exit 0 when every
  # declared node-level entry serves exactly its mounts, with Funnel exactly
  # where declared and on no other port, foreground sessions' included; 1 with one line per difference on
  # stdout; 2 when tailscaled cannot be read.
  driftScript = ''
    set -eu
    read_status_exit=2
    ${statusLib}
    read_status
    drift=
    ${concatStringsSep "\n" (
      map (
        entry:
        let
          port = toString entry.port;
        in
        ''
          if ! port_exact ${port} ${expectedMounts entry}; then
            echo "HTTPS port ${port} does not serve exactly its declared mounts. It serves:"
            port_mounts ${port} | ${sed} 's/^/  /'
            echo "  declared:"
            ${sed} 's/^/  /' ${expectedMounts entry}
            drift=1
          fi
          funnel=off
          if funnel_ports | ${pkgs.gnugrep}/bin/grep -qxF ${port}; then funnel=on; fi
          if [ "$funnel" != ${if entry.funnel then "on" else "off"} ]; then
            echo "Funnel is $funnel for HTTPS port ${port}, declared ${
              if entry.funnel then "with Funnel" else "tailnet-only"
            }"
            drift=1
          fi
        ''
      ) nodeEntries
    )}
    for port in $(funnel_ports); do
      case " ${concatStringsSep " " nodePorts} " in
        *" $port "*) ;;
        *) echo "Funnel is on for HTTPS port $port, which no declared entry serves"; drift=1 ;;
      esac
    done
    # A foreground `tailscale funnel <port>` keeps its listener in its own
    # session (.Foreground[]), and tailscaled publishes it as well
    # (ipn/serve.go). No declaration covers one, so any is drift. Only this
    # check looks there: the reconcile manages the node's own listeners.
    for port in $(printf '%s' "$status" | ${jq} -r '
      .Foreground // {} | to_entries[] | .value.AllowFunnel // {} | to_entries[]
      | select(.value) | .key | sub(".*:"; "")' | ${sort} -u); do
      echo "Funnel is on for HTTPS port $port through a foreground session (tailscale funnel), which no declared entry covers"
      drift=1
    done
    [ -z "$drift" ]
  '';

  script = ''
    set -eu

    ${tailscale} wait --timeout=2m

    state_dir=${stateDir}
    managed_services="$state_dir/managed-services"
    managed_node_ports="$state_dir/managed-node-ports"
    ${pkgs.coreutils}/bin/mkdir -p "$state_dir"
    failed=

    ${statusLib}
    is_managed() {
      [ -f "$managed_node_ports" ] && ${pkgs.gnugrep}/bin/grep -qxF "$1" "$managed_node_ports"
    }
    keeps_funnel() {
      case $1 in
        ${keepsFunnel}
        *) return 1 ;;
      esac
    }
    refuse_port() {
      echo "tailscale-services: HTTPS port $1 is already served by something this configuration does not manage; not taking it over. It serves:" >&2
      port_listener "$1" | ${sed} 's/^/  listener /' >&2
      port_mounts "$1" | ${sed} 's/^/  /' >&2
      echo "  Clear it with 'sudo tailscale serve --https=$1 off' ('adhoc off' leaves a declared port alone); this job retries every 30 s and takes the port once it is free." >&2
      failed=1
    }

    # 1. Public exposure first, before anything that can fail. A port this
    # job manages keeps Funnel only when it is declared with Funnel and
    # serves exactly the declared mounts; any other loses its mounts and
    # Funnel with them (step 3 sets the mounts again). Funnel on a port this
    # job does not manage (set by hand) is not this job's: a warning, no
    # change, since turning it off would also drop that port's tailnet mounts.
    # Not `funnel reset`: that clears the whole serve config, Services and
    # adhoc shares included.
    read_status
    for port in $(funnel_ports); do
      if ! is_managed "$port"; then
        echo "tailscale-services: warning: Funnel is on for HTTPS port $port, which this configuration does not manage; leaving it (tailscale funnel status)" >&2
      elif ! keeps_funnel "$port"; then
        echo "tailscale-services: taking Funnel down on HTTPS port $port" >&2
        if ! ${tailscale} serve --yes --https="$port" off; then
          echo "tailscale-services: could not take Funnel down on HTTPS port $port" >&2
          exit 1
        fi
      fi
    done

    # 2. Tailscale Services.
    if [ -f "$managed_services" ]; then
      while IFS= read -r service_name; do
        [ -z "$service_name" ] || ${tailscale} serve clear "$service_name" || true
      done < "$managed_services"
    fi

    ${configureServices}

    ${pkgs.coreutils}/bin/install -m 0600 ${serviceNamesFile} "$managed_services.new"
    ${pkgs.coreutils}/bin/mv "$managed_services.new" "$managed_services"

    # 3. Node-level entries: drop the ones this job set last time, then set
    # the declared ones on ports nothing else serves.
    read_status
    if [ -f "$managed_node_ports" ]; then
      while IFS= read -r port; do
        if [ -n "$port" ] && port_taken "$port"; then
          ${tailscale} serve --yes --https="$port" off
        fi
      done < "$managed_node_ports"
    fi
    : > "$managed_node_ports"
    ${pkgs.coreutils}/bin/chmod 0600 "$managed_node_ports"

    ${configureNodeServe}

    [ -z "$failed" ] || exit 1
  '';
}
