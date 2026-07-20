_:

let
  # MagicDNS tailnet identifier. Service origins on this host derive from
  # this binding so moving to another tailnet is a one-line change.
  tailnetId = "taild98079";
in

# Personal machine.
# Only diffs from the shared Darwin system module go here.
{
  imports = [ ../../modules/darwin/system ];

  my.role = "personal";

  # Functional stacks (modules/stacks/*) enabled on this machine.
  my.stacks = {
    ai-agents = {
      enable = true;
      cognee = {
        enable = true;
        publicUrl = "https://cognee.${tailnetId}.ts.net";
      };
    };
    office-docs.enable = true;
    vpn = {
      enable = true;
      services.cognee.target = "http://127.0.0.1:8088";
    };
  };
}
