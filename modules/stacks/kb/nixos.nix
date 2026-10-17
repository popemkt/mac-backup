{ config, ... }:

# NixOS side of the kb stack. The CLI comes from the shared ./default.nix;
# the browser UI service has no NixOS implementation yet.
{
  # GAP [[01M52TVK8YAZDN3R8V0CB99GSW]] kb.server has no NixOS side.
  assertions = [
    {
      assertion = !(config.my.stacks.kb.enable && config.my.stacks.kb.server.enable);
      message = "my.stacks.kb.server has no NixOS implementation yet; only the kb CLI is available here.";
    }
  ];
}
