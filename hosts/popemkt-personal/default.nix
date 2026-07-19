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
      cognee = {
        enable = true;
        publicUrl = "https://cognee.taild98079.ts.net";
      };
    };
    office-docs.enable = true;
    vpn = {
      enable = true;
      services.cognee.target = "http://127.0.0.1:8088";
    };
  };
}
