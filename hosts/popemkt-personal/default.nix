_:

# Personal machine.
# Only diffs from the shared Darwin system module go here.
{
  imports = [ ../../modules/darwin/system ];

  my.role = "personal";

  # Functional stacks (modules/stacks/*) enabled on this machine.
  my.stacks = {
    ai-agents.enable = true;
    office-docs.enable = true;
    # vpn.services.<name> = { target = "http://127.0.0.1:PORT"; ... } to host
    # a Tailscale Service; empty leaves just the app/CLI installed.
    vpn.enable = true;
  };
}
