{
  config,
  osConfig,
  lib,
  pkgs,
  ...
}:

# Executor: bb plugins kept in this repo, merged from the intent layer
# (modules/stacks/*) through my.pkgs.bbPlugins. Each entry is a plugin folder
# relative to the person's dotfiles checkout, installed in place with
# `bb plugin install <path>`, as Claude Code reads the repo's folder
# marketplace in place.
#
# The installer is one command, bb-plugins-sync. Home Manager activation runs
# it, and so does scripts/rebuild after every switch: plugin sources live in
# the checkout, not the Nix closure, so a plugin-only change (or an
# interrupted activation) leaves the generation unchanged and activation does
# not rerun. A plugin is reinstalled only when its tracked files or
# uncommitted edits change, and its npm dependencies are reinstalled only when
# its lockfile changes, so an unchanged sync costs one `bb plugin list`.
#
# `bb-plugins-sync --path <dir>` installs one plugin from any folder (a
# worktree) to try it without a rebuild. It replaces the declared install of
# the same plugin id, and the next plain sync reinstalls the declared source.
#
# bb installs into its running server, so this is best effort: with no bb
# CLI, no server answering (the desktop app closed, or a person who runs
# none), or no checkout, it warns, exits 0, and the next rebuild tries again.
let
  home = config.home.homeDirectory;
  plugins = lib.unique osConfig.my.pkgs.bbPlugins;

  bbPluginsSync = pkgs.writeShellApplication {
    name = "bb-plugins-sync";
    runtimeInputs = [
      pkgs.nodejs
      pkgs.git
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

      state="''${XDG_STATE_HOME:-${home}/.local/state}/dotfiles/bb-plugins"
      mkdir -p "$state"

      # install <dir> <label> [lock-stamp-file]: npm dependencies when missing
      # or when the lockfile moved since the stamp, then the plugin itself.
      install() {
        local dir="$1" label="$2" lockfile="''${3:-}" lock=""
        lock="$(sha256sum "$dir/package-lock.json" 2>/dev/null | cut -d' ' -f1)" || true
        if [ ! -d "$dir/node_modules" ] \
          || { [ -n "$lockfile" ] && [ "$(cat "$lockfile" 2>/dev/null)" != "$lock" ]; }; then
          echo "Installing npm dependencies of bb plugin: $label"
          # Optional dependencies are platform binaries a plugin does not need
          # here (Claude Code itself comes from PATH); bb's git installs omit them too.
          if ! (cd "$dir" && npm ci --omit=optional --no-audit --no-fund >/dev/null); then
            echo "warning: npm ci failed for $label; skipped it" >&2
            return 1
          fi
          if [ -n "$lockfile" ]; then printf '%s' "$lock" >"$lockfile"; fi
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

      for rel in ${lib.concatStringsSep " " (map lib.escapeShellArg plugins)}; do
        dir="${home}/.dotfiles/$rel"
        if [ ! -f "$dir/package.json" ]; then
          echo "warning: no bb plugin at $dir; skipped it" >&2
          continue
        fi
        key="$(printf '%s' "$rel" | tr '/' '_')"
        # What an install is built from: every tracked file, plus uncommitted edits,
        # of the plugin and of the shared code beside it: a sibling folder with no
        # package.json is no plugin, and plugins import it by relative path
        # (assets/bb-plugins/linked-items).
        shared=()
        for sibling in "$dir"/../*/; do
          [ -f "$sibling/package.json" ] || shared+=("$sibling")
        done
        stamp="$(cd "$dir" && { git ls-files -s . "''${shared[@]}"; git diff HEAD -- . "''${shared[@]}"; } | sha256sum | cut -d' ' -f1)"
        # A here-string, not a pipe: under pipefail, grep -q exiting at the
        # first match SIGPIPEs printf on a long listing and reads as "absent".
        if grep -qF "path:$dir\"" <<<"$listing" \
          && [ "$(cat "$state/$key" 2>/dev/null)" = "$stamp" ]; then
          continue
        fi
        if install "$dir" "$rel" "$state/$key.lock"; then
          printf '%s' "$stamp" >"$state/$key"
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
