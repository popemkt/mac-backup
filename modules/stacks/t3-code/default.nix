{ lib, ... }:

# T3 Code: agent harness control surface. This file owns the schema, which
# every platform shares; ./darwin.nix and ./nixos.nix are the platform sides.
let
  mkStack = import ../mk-stack.nix lib;
  inherit (lib) mkOption types;
in
{
  options.my.stacks.t3-code = mkStack {
    description = "T3 Code agent harness control surface";
    componentOptions.instances = mkOption {
      default = { };
      description = ''
        Headless T3 Code servers this host runs, one per entry, each as the
        user it names and bound to loopback. Publish one on the tailnet by
        pointing a `my.stacks.vpn.services` target at its `listenOrigin`.
      '';
      type = types.attrsOf (
        types.submodule (
          { config, name, ... }:
          {
            options = {
              user = mkOption {
                type = types.str;
                default = name;
                description = "Account the server runs as; its threads and agent logins live in that home.";
              };
              port = mkOption {
                type = types.port;
                description = "Loopback port the server listens on.";
              };
              listenOrigin = mkOption {
                type = types.str;
                readOnly = true;
                default = "http://127.0.0.1:${toString config.port}";
                description = "Loopback origin the server listens on, derived from its port.";
              };
            };
          }
        )
      );
    };
  };
}
