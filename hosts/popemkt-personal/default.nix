_:

# Personal machine.
# Only diffs from the shared Darwin system module go here.
{
  imports = [ ../../modules/darwin/system ];

  my.role = "personal";

  # Cognee 1.4 can retain database descriptors across recall requests. The
  # macOS launchd default of 256 turns that leak into HTTP 409/500 responses
  # after a few days, so contain it to the only host running the API.
  launchd.user.agents.cognee-api.serviceConfig = {
    SoftResourceLimits.NumberOfFiles = 65536;
    HardResourceLimits.NumberOfFiles = 65536;
  };

  # Functional stacks (modules/stacks/*) enabled on this machine.
  my.stacks = {
    ai-agents = {
      enable = true;
      cognee.server.enable = true;
    };
    office-docs.enable = true;
    vpn = {
      enable = true;
      # Stable tailnet entry point for temporary HTTP apps. Start an app on
      # 127.0.0.1:9000 and it becomes available at
      # https://adhoc.<tailnet-domain>; no listener is kept alive by Nix.
      services.adhoc.target = "http://127.0.0.1:9000";
      services.cognee.target = "http://127.0.0.1:8088";
    };
  };

  # This machine is the tailnet's stateful service host. Let displays and
  # disks idle normally, but keep the computer reachable and reboot after an
  # outage. Cognee's user agents resume once this account logs in.
  power = {
    restartAfterPowerFailure = true;
    sleep.computer = "never";
  };
}
