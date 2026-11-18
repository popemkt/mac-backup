{
  config,
  lib,
  pkgs,
  ...
}:

# Work machine.
# Only diffs from the shared Darwin system module go here.
{
  imports = [ ../../modules/darwin/system ];

  my.role = "work";

  # Functional stacks (modules/stacks/*) enabled on this machine.
  my.stacks = {
    ai-agents = {
      enable = true;
      cognee.client = {
        enable = true;
        dataset = "work";
      };
      cliProxyClients.tinycast.enable = true;
    };
    bb.enable = true;
    browsers.enable = true;
    kb = {
      enable = true;
      # kb-work's store as the MCP server `kb-work` in every agent here.
      mcp = {
        enable = true;
        name = "kb-work";
      };
      server = {
        enable = true;
        publicOrigin = config.my.stacks.vpn.services.kb-work.publicOrigin;
        aliasOrigins.local = config.my.stacks.local-proxy.sites.kb-work.origin;
        # popemkt's bb (svc:bb-popemkt on shared-server) frames this store
        # beside a thread, as its kb store `kb-work` (hosts/shared-server,
        # bbHome).
        embedOrigins = [ "https://bb-popemkt.${config.my.stacks.vpn.tailnetDomain}" ];
      };
    };
    local-proxy = {
      enable = true;
      sites.kb-work.target = config.my.stacks.kb.server.listenOrigin;
    };
    office-docs.enable = true;
    t3-code.enable = true;
    vpn = {
      enable = true;
      tags = [ "tag:orca-host" ];
      services.kb-work.target = config.my.stacks.kb.server.listenOrigin;
    };
  };

  my.systemSetup.integrations = {
    kb-ui.dependsOn = [ "tailscale-service-kb-work" ];
    kb-ui-local.dependsOn = [ "local-proxy-trust" ];
  };

  # Work-only GUI apps; merged with the shared Homebrew module.
  homebrew.casks = [
    "microsoft-outlook"
    "microsoft-teams"
    "onedrive"
    "slack"
  ];

  # ESET denies inbound traffic by default. Reconcile the narrow Orca rule
  # after every rebuild so the native Orca Mobile listener remains reachable.
  system.activationScripts.postActivation.text = lib.mkAfter ''
    eset_cfg="/Applications/ESET Endpoint Security.app/Contents/MacOS/cfg"
    if [ -x "$eset_cfg" ]; then
      $DRY_RUN_CMD ${pkgs.python3}/bin/python3 \
        ${../../scripts/reconcile_eset_orca_firewall.py} \
        --cfg "$eset_cfg" \
        --application "/Applications/Orca.app/Contents/MacOS/Orca" \
        --local-address ${lib.escapeShellArg config.my.stacks.vpn.knownDevices.work} \
        --remote-address ${lib.escapeShellArg config.my.stacks.vpn.knownDevices.pocoF8Pro} \
        --remote-address ${lib.escapeShellArg config.my.stacks.vpn.knownDevices.xiaomiPad7}
    else
      echo "ESET is not installed; skipping the Orca Mobile firewall rule"
    fi
  '';

  # Autostart Outlook at login (-g = don't focus, -j = launch hidden).
  # RunAtLoad also fires once at rebuild activation, not just login.
  launchd.user.agents.outlook-autostart = {
    serviceConfig = {
      ProgramArguments = [
        "/usr/bin/open"
        "-gj"
        "-a"
        "Microsoft Outlook"
      ];
      RunAtLoad = true;
    };
  };
}
