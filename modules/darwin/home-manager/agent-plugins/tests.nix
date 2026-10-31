{ pkgs }:

# Builds agent-plugins-sync and the installAgentPlugins activation exactly as
# ./default.nix does, for a home that ./tests.sh moves under the build
# directory, and runs ./tests.sh over them against fake claude, codex and omp
# that log their arguments: the move off the checkout-based links and
# marketplace, a sync with nothing to do, a --path trial and the way back,
# failed probes, a person's own folder in the way, and an undeclared link.
let
  inherit (pkgs) lib;
  home = "/agent-plugins-test-home";
  module = import ./default.nix {
    config = {
      home.homeDirectory = home;
      xdg.stateHome = "${home}/.local/state";
    };
    osConfig.my.pkgs = {
      claudeMarketplaces = [
        "dotfiles=./assets/plugins"
        "upstream=owner/upstream"
      ];
      claudePlugins = [
        "agent-artifacts@dotfiles"
        "tool@upstream"
      ];
      codexMarketplaces = [ "upstream=owner/upstream@main" ];
      codexPlugins = [ "tool@upstream" ];
    };
    lib = lib // {
      hm.dag.entryAfter = after: data: { inherit after data; };
    };
    inherit pkgs;
  };
  sync = lib.findFirst (p: p.name == "agent-plugins-sync") null module.home.packages;
in
pkgs.runCommand "agent-plugins-check"
  {
    nativeBuildInputs = [
      pkgs.coreutils
      pkgs.gnused
      pkgs.gnugrep
    ];
    placeholderHome = home;
    sync = lib.getExe sync;
    activation = pkgs.writeShellScript "install-agent-plugins" module.home.activation.installAgentPlugins.data;
    jq = lib.getExe pkgs.jq;
    shell = pkgs.runtimeShell;
    repoPlugins = ../../../../assets/plugins;
  }
  ''
    ${pkgs.bash}/bin/bash ${./tests.sh}
    touch "$out"
  ''
