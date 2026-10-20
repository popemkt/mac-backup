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
# bb installs into its running server, so this is best effort: with no bb
# CLI, no server answering (the desktop app closed, or a person who runs
# none), or no checkout, it warns and the next rebuild tries again. A plugin
# is reinstalled only when its tracked files or uncommitted edits change, and
# its npm dependencies are reinstalled only when its lockfile changes.
let
  home = config.home.homeDirectory;
  plugins = lib.unique osConfig.my.pkgs.bbPlugins;

  installScript = ''
    bb_plugins() {
      local bb="" candidate
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
        return 0
      fi
      # Listing is also the readiness probe: it fails when no server answers.
      local listing
      if ! listing="$("$bb" plugin list --json 2>/dev/null)"; then
        echo "warning: no bb server answered; skipped its tracked plugins until the next rebuild" >&2
        return 0
      fi

      local state="''${XDG_STATE_HOME:-${home}/.local/state}/dotfiles/bb-plugins"
      mkdir -p "$state"
      local rel dir key stamp lock
      for rel in ${lib.concatStringsSep " " (map lib.escapeShellArg plugins)}; do
        dir="${home}/.dotfiles/$rel"
        if [ ! -f "$dir/package.json" ]; then
          echo "warning: no bb plugin at $dir; skipped it" >&2
          continue
        fi
        key="$(printf '%s' "$rel" | tr '/' '_')"
        # What an install is built from: every tracked file, plus uncommitted edits.
        stamp="$(cd "$dir" && { git ls-files -s .; git diff HEAD -- .; } | sha256sum | cut -d' ' -f1)"
        if printf '%s' "$listing" | grep -qF "path:$dir\"" \
          && [ "$(cat "$state/$key" 2>/dev/null)" = "$stamp" ]; then
          continue
        fi
        lock="$(sha256sum "$dir/package-lock.json" | cut -d' ' -f1)"
        if [ ! -d "$dir/node_modules" ] || [ "$(cat "$state/$key.lock" 2>/dev/null)" != "$lock" ]; then
          echo "Installing npm dependencies of bb plugin: $rel"
          # Optional dependencies are platform binaries a plugin does not need
          # here (Claude Code itself comes from PATH); bb's git installs omit them too.
          if ! (cd "$dir" && npm ci --omit=optional --no-audit --no-fund >/dev/null); then
            echo "warning: npm ci failed for $rel; skipped it" >&2
            continue
          fi
          printf '%s' "$lock" >"$state/$key.lock"
        fi
        echo "Installing bb plugin: $rel"
        if "$bb" plugin install "$dir" --yes >/dev/null; then
          printf '%s' "$stamp" >"$state/$key"
        else
          echo "warning: failed to install bb plugin $rel" >&2
        fi
      done
    }
  '';
in
{
  home.activation.installBbPlugins = lib.mkIf (plugins != [ ]) (
    lib.hm.dag.entryAfter [ "installNpmGlobals" ] ''
      export PATH="${
        lib.makeBinPath [
          pkgs.nodejs
          pkgs.git
          pkgs.coreutils
          pkgs.gnugrep
        ]
      }:${home}/.local/bin:$PATH"
      ${installScript}
      bb_plugins
    ''
  );
}
