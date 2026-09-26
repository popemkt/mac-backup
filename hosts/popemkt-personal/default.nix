_:

# Personal machine.
# Only diffs from the shared Darwin system module go here.
{
  imports = [ ../../modules/darwin/system ];

  my.role = "personal";

  # Functional stacks (modules/stacks/*) enabled on this machine.
  my.stacks = {
    ai-agents = {
      enable = true;
      cognee.server.enable = true;
    };
    browsers.enable = true;
    office-docs.enable = true;
    vpn = {
      enable = true;
      # The home kb UI listens on loopback; Tailscale provides its HTTPS name.
      services.kb.target = "http://127.0.0.1:9000";
      # Keep a separate endpoint available for temporary HTTP apps.
      services.adhoc.target = "http://127.0.0.1:9001";
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
