{ pkgs }:

# Builds mcp-servers-sync exactly as ./default.nix does, for a home that
# ./tests.sh moves under the build directory, and runs ./tests.sh over it
# against fake claude and codex that keep their registrations in files: a
# first registration in every harness, a sync with nothing to do, a server
# changed and one dropped, --check, failed listings, a harness that is not
# installed, and a file that is not plain JSON.
let
  inherit (pkgs) lib;
  home = "/mcp-servers-test-home";
  module =
    servers:
    import ./default.nix {
      config = {
        home.homeDirectory = home;
        xdg.stateHome = "${home}/.local/state";
      };
      osConfig.my.pkgs.mcpServers = servers;
      lib = lib // {
        hm.dag.entryAfter = after: data: { inherit after data; };
      };
      inherit pkgs;
    };
  syncOf = servers: lib.getExe (lib.head (module servers).home.packages);
in
pkgs.runCommand "mcp-servers-check"
  {
    nativeBuildInputs = [
      pkgs.coreutils
      pkgs.gnused
      pkgs.gnugrep
    ];
    placeholderHome = home;
    # Two servers, then one changed (an argument) and the other dropped.
    first = syncOf {
      kb-work = {
        command = "/nix/store/kb/bin/kb";
        args = [
          "--root"
          "/Users/me/Library/Application Support/kb/home"
          "mcp"
        ];
      };
      other = {
        command = "/nix/store/other/bin/other";
        env.TOKEN_FILE = "/run/other token";
      };
    };
    second = syncOf {
      kb-work = {
        command = "/nix/store/kb/bin/kb";
        args = [
          "--root"
          "/elsewhere"
          "mcp"
        ];
      };
    };
    jq = lib.getExe pkgs.jq;
    shell = pkgs.runtimeShell;
  }
  ''
    ${pkgs.bash}/bin/bash ${./tests.sh}
    touch "$out"
  ''
