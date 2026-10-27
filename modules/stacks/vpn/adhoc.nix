{
  pkgs,
  cfg,
  hostname,
  tailscale,
  ssh,
}:
# The `adhoc` command, shared by every platform. The platform modules
# (./darwin.nix, ./nixos.nix) supply the `tailscale` CLI (the macOS app's, not a
# second daemon) and the ssh client, and install the result for every person.
# The script is ./adhoc.sh; this file hands it its constants.
#
# `adhoc <port>` serves a loopback port on this machine's own tailnet name.
# `adhoc --shared <port>` reverse-forwards it to the fixed endpoint on the
# shared host, whose port and origin come from that host's own declaration
# (`cfg.sharedAdhoc`, wired in flake.nix).
let
  shared = cfg.sharedAdhoc;
  # The shared endpoint's target is "http://127.0.0.1:<port>" (see
  # services-reconcile.nix's loopback rule); the port is the one thing the
  # forward needs.
  targetPort =
    let
      m = builtins.match "https?://(127\\.0\\.0\\.1|localhost):([0-9]+)/?" shared.target;
    in
    if m == null then
      throw "my.stacks.vpn.sharedAdhoc.target must be a loopback http(s) origin with a port, got ${shared.target}"
    else
      builtins.elemAt m 1;
in
pkgs.writeShellApplication {
  name = "adhoc";
  runtimeInputs = with pkgs; [
    coreutils
    gawk
    gnugrep
    jq
  ];
  runtimeEnv = {
    ADHOC_TAILSCALE = tailscale;
    ADHOC_SSH = ssh;
    ADHOC_SHARED_HOST = shared.host;
    # popemkt owns the endpoint (svc:adhoc-popemkt) and logs in to forward
    # to it; the account is a person, not something the host config names.
    ADHOC_SHARED_USER = "popemkt";
    ADHOC_SHARED_PORT = targetPort;
    ADHOC_SHARED_URL = shared.origin;
    ADHOC_ON_SHARED = if hostname == shared.host then "1" else "0";
  };
  text = builtins.readFile ./adhoc.sh;
  meta.mainProgram = "adhoc";
}
