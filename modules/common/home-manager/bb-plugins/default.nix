{
  config,
  osConfig,
  lib,
  pkgs,
  ...
}:

# Executor: bb plugins kept in this repo, merged from the intent layer
# (modules/stacks/*) through my.pkgs.bbPlugins. Each entry is a plugin folder
# relative to the repo root.
#
# A rebuild installs exactly the plugin sources of the revision it applies:
# each declared folder is copied into the Nix store at evaluation
# (./source.nix), never read from a person's checkout at run time, which may
# be behind or ahead of what is being applied (on a host several people
# apply from, another person's rebuild once installed an old bb-lively from a
# stale checkout).
#
# bb loads a path-installed plugin in place and writes into its folder: the
# install builds dist/ there, from the node_modules it finds there. A store
# path is read-only (`bb plugin build` fails with EACCES on mkdir dist), so
# bb-plugins-sync (./sync.sh) copies each plugin's store path to a per-user
# state directory, $XDG_STATE_HOME/dotfiles/bb-plugins/<plugin>/src/<hash>,
# adds node_modules installed once per lockfile (…/deps/<lockfile hash>, so a
# source-only change needs no network), and installs from the copy. The
# copy's path names its content, so a plugin bb already runs from it is
# skipped: an unchanged sync costs one `bb status` and one `bb plugin list`.
# The previous copy stays until the next install of that plugin.
#
# It installs only into a bb server this account owns (its data directory is
# under this home): on a shared host the bb CLI of every account reaches the
# one server listening on bb's default port.
#
# Home Manager activation runs bb-plugins-sync, and so does scripts/rebuild
# after every switch, so a sync activation skipped (no bb server answering,
# or an interrupted activation) catches up without a new generation.
#
# `bb-plugins-sync --path <dir>` installs one plugin from any folder (a
# worktree), in place, to try it without a rebuild. It replaces the declared
# install of the same plugin id, and the next plain sync reinstalls the
# declared source.
#
# bb installs into its running server, so this is best effort: whatever
# fails (no bb, no server, a failed npm ci or install, a full disk) warns,
# exits 0, keeps what bb runs, and the next rebuild tries again.
let
  home = config.home.homeDirectory;
  repoRoot = ../../../..;
  source = import ./source.nix { inherit lib; };

  # A declared folder that is no plugin warns rather than failing every
  # evaluation; the rest go to the sync as <plugin>=<store path>.
  entries = lib.concatMap (
    rel:
    let
      dir = repoRoot + "/${rel}";
    in
    if builtins.pathExists (dir + "/package.json") then
      [ "${baseNameOf rel}=${source dir}" ]
    else
      lib.warn "my.pkgs.bbPlugins: no bb plugin (package.json) at ${rel}; it is not installed" [ ]
  ) (lib.unique osConfig.my.pkgs.bbPlugins);

  bbPluginsSync = pkgs.writeShellApplication {
    name = "bb-plugins-sync";
    text = ''
      home=${lib.escapeShellArg home}
      plugins=(${lib.concatMapStringsSep " " lib.escapeShellArg entries})
      cu=${pkgs.coreutils}/bin
      find=${pkgs.findutils}/bin/find
      flock=${pkgs.flock}/bin/flock
      grep=${pkgs.gnugrep}/bin/grep
      node=${pkgs.nodejs}/bin/node
      npm=${pkgs.nodejs}/bin/npm
      # npm's own scripts and node-gyp look node up on PATH.
      export PATH="${pkgs.nodejs}/bin:$PATH"

    ''
    + builtins.readFile ./sync.sh;
  };
in
lib.mkIf (osConfig.my.pkgs.bbPlugins != [ ]) {
  home.packages = [ bbPluginsSync ];

  home.activation.installBbPlugins = lib.hm.dag.entryAfter [ "installNpmGlobals" ] ''
    ${lib.getExe bbPluginsSync}
  '';
}
