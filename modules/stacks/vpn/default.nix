{ config, lib, ... }:

# VPN stack: the Tailscale mesh. The app (menu-bar client + /usr/local/bin
# CLI) is the install-only part; tailscale-services.nix is the per-host
# service-hosting daemon, self-gated on my.tailscaleServices.enable (only
# meaningful when this stack is on, since it drives the app's CLI).
{
  imports = [
    ./tailscale-services.nix
  ];

  config = lib.mkIf config.my.stacks.vpn.enable {
    my.pkgs.casks = [
      "tailscale-app"
    ]
    ++ config.my.stacks.vpn.extra.casks;
  };
}
