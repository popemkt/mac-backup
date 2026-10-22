{ config, lib, ... }:

# macOS side of the kb stack: the browser UI as the primary user's launchd
# agent (./server.nix) and its enrollment checks (./system-setup.nix).
let
  inherit (config.users.users.${config.my.username}) home;
in
{
  imports = [
    ./server.nix
    ./system-setup.nix
  ];

  # kb's home store on macOS (kb DESIGN.md → Locations): personal state,
  # backed up, never committed. kb ui creates it on first start.
  my.stacks.kb.server.root = lib.mkDefault "${home}/Library/Application Support/kb/home";
}
