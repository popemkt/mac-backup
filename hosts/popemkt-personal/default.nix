_:

# Personal machine (placeholder until it's set up).
# Only diffs from the shared Darwin system module go here.
{
  imports = [ ../../modules/darwin/system ];

  my.role = "personal";

  # Functional stacks (modules/stacks/*) enabled on this machine.
  my.stacks = {
    ai-agents = true;
    office-docs = true;
  };

  # Each entry gets its own TailVIP, MagicDNS name, HTTPS certificate, and
  # grant target. Services stay private until explicitly listed here.
  my.tailscaleServices = {
    enable = true;
    services = { };
  };
}
