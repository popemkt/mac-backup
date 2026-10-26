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
# each declared folder is copied into the Nix store at evaluation, never read
# from a person's checkout at run time, which may be behind or ahead of what
# is being applied (on a host several people apply from, another person's
# rebuild once installed an old bb-lively from a stale checkout).
#
# bb loads a path-installed plugin in place and writes into its folder: the
# install builds dist/ there, and builds from the node_modules it finds
# there. A store path is read-only, so bb-plugins-sync copies each plugin's
# store path to a per-user state directory keyed by the store hash
# ($XDG_STATE_HOME/dotfiles/bb-plugins/<plugin>/<hash>), runs `npm ci` in the
# copy, and installs from it. Since the copy's path names its content, a
# plugin is reinstalled only when its store path changes: one bb already runs
# from that path is skipped, so an unchanged sync costs one `bb plugin list`.
# After a plugin installs, older copies of it are deleted.
#
# Home Manager activation runs bb-plugins-sync, and so does scripts/rebuild
# after every switch, so a sync that activation skipped (no bb server
# answering, or an interrupted activation) catches up without a new
# generation.
#
# `bb-plugins-sync --path <dir>` installs one plugin from any folder (a
# worktree), in place, to try it without a rebuild. It replaces the declared
# install of the same plugin id, and the next plain sync reinstalls the
# declared source.
#
# bb installs into its running server, so this is best effort: with no bb
# CLI, or no server answering (the desktop app closed, or a person who runs
# none), it warns, exits 0, and the next rebuild tries again.
let
  home = config.home.homeDirectory;
  fs = lib.fileset;
  repoRoot = ../../..;
  plugins = lib.unique osConfig.my.pkgs.bbPlugins;

  # A declared plugin's store copy: its folder and the shared code beside it,
  # rooted at their parent so relative imports hold. A sibling folder with no
  # package.json is no plugin but shared code plugins import by relative path
  # (assets/bb-plugins/linked-items); a change there changes every plugin's
  # store path, as it changes what each one builds.
  pluginSource =
    rel:
    let
      dir = repoRoot + "/${rel}";
      parent = dirOf dir;
      shared = lib.mapAttrsToList (name: _: parent + "/${name}") (
        lib.filterAttrs (
          name: type: type == "directory" && !builtins.pathExists (parent + "/${name}/package.json")
        ) (builtins.readDir parent)
      );
      # The flake source holds tracked files only; this guards an evaluation
      # of a plain folder, where an in-place trial left build output behind.
      output = fs.unions (
        lib.concatMap (d: [
          (fs.maybeMissing (d + "/node_modules"))
          (fs.maybeMissing (d + "/dist"))
        ]) ([ dir ] ++ shared)
      );
    in
    if !builtins.pathExists (dir + "/package.json") then
      throw "my.pkgs.bbPlugins: no bb plugin (package.json) at ${rel}"
    else
      "${baseNameOf rel}=${
        fs.toSource {
          root = parent;
          fileset = fs.difference (fs.unions ([ dir ] ++ shared)) output;
        }
      }";

  bbPluginsSync = pkgs.writeShellApplication {
    name = "bb-plugins-sync";
    runtimeInputs = [
      pkgs.nodejs
      pkgs.coreutils
      pkgs.gnugrep
    ];
    text = ''
      export PATH="$PATH:${home}/.local/bin"

      try_path=""
      case "''${1:-}" in
        "") ;;
        --path)
          if [ -z "''${2:-}" ] || [ ! -f "$2/package.json" ]; then
            echo "bb-plugins-sync: --path needs a bb plugin folder (with package.json)" >&2
            exit 2
          fi
          try_path="$(cd "$2" && pwd)"
          ;;
        *)
          echo "usage: bb-plugins-sync [--path <plugin-dir>]" >&2
          exit 2
          ;;
      esac

      bb=""
      for candidate in \
        "$(command -v bb 2>/dev/null || true)" \
        "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb" \
        "${home}/.local/bin/bb"; do
        if [ -n "$candidate" ] && [ -x "$candidate" ]; then
          bb="$candidate"
          break
        fi
      done
      if [ -z "$bb" ]; then
        echo "warning: bb is unavailable; skipped its tracked plugins" >&2
        exit 0
      fi
      # Listing is also the readiness probe: it fails when no server answers.
      if ! listing="$("$bb" plugin list --json 2>/dev/null)"; then
        echo "warning: no bb server answered; skipped its tracked plugins until the next rebuild" >&2
        exit 0
      fi

      # install <dir> <label>: npm dependencies when missing, then the plugin.
      install() {
        local dir="$1" label="$2"
        if [ ! -d "$dir/node_modules" ]; then
          echo "Installing npm dependencies of bb plugin: $label"
          # Optional dependencies are platform binaries a plugin does not need
          # here (Claude Code itself comes from PATH); bb's git installs omit them too.
          if ! (cd "$dir" && npm ci --omit=optional --prefer-offline --no-audit --no-fund >/dev/null); then
            echo "warning: npm ci failed for $label; skipped it" >&2
            return 1
          fi
        fi
        echo "Installing bb plugin: $label"
        if ! "$bb" plugin install "$dir" --yes >/dev/null; then
          echo "warning: failed to install bb plugin $label" >&2
          return 1
        fi
      }

      if [ -n "$try_path" ]; then
        install "$try_path" "$try_path" || exit 1
        echo "Installed $try_path; the next bb-plugins-sync (or rebuild) reinstalls the declared source."
        exit 0
      fi

      state="''${XDG_STATE_HOME:-${home}/.local/state}/dotfiles/bb-plugins"
      mkdir -p "$state"
      # Stamps of the checkout-based installer this replaced, and copies an
      # interrupted sync left half made.
      rm -rf "$state"/assets_bb-plugins_* "$state"/.copy.*

      # Each entry is <plugin>=<store path>; the plugin sits at <store path>/<plugin>.
      for entry in ${
        lib.concatStringsSep " " (map (rel: lib.escapeShellArg (pluginSource rel)) plugins)
      }; do
        name="''${entry%%=*}"
        store="''${entry#*=}"
        hash="$(basename "$store")"
        hash="''${hash%%-*}"
        copy="$state/$name/$hash"
        dir="$copy/$name"
        # A here-string, not a pipe: under pipefail, grep -q exiting at the
        # first match SIGPIPEs printf on a long listing and reads as "absent".
        if [ -d "$dir" ] && grep -qF "path:$dir\"" <<<"$listing"; then
          continue
        fi
        if [ ! -d "$copy" ]; then
          # Copied whole, then renamed, so a copy that exists is complete.
          tmp="$(mktemp -d "$state/.copy.XXXXXX")"
          cp -R "$store/." "$tmp/"
          chmod -R u+w "$tmp"
          mkdir -p "$state/$name"
          mv "$tmp" "$copy"
        fi
        if install "$dir" "$name@$hash"; then
          for old in "$state/$name"/*; do
            if [ "$old" != "$copy" ]; then rm -rf "$old"; fi
          done
        fi
      done
    '';
  };
in
lib.mkIf (plugins != [ ]) {
  home.packages = [ bbPluginsSync ];

  home.activation.installBbPlugins = lib.hm.dag.entryAfter [ "installNpmGlobals" ] ''
    ${lib.getExe bbPluginsSync}
  '';
}
