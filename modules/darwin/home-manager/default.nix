{ lib, pkgs, ... }:

{
  imports = [
    ./agent-plugins.nix
    ./bun-global.nix
    ./mackup.nix
  ];

  # ============================================================================
  # DARWIN-SPECIFIC HOME-MANAGER SETTINGS
  # ============================================================================

  # stateVersion is still 24.05, so HM defaults to linkApps (nix-store
  # symlinks). Spotlight/Launchpad ignore those; copyApps materializes real
  # .app bundles instead. Keep the dedicated subdirectory — copyApps uses
  # rsync --delete, so pointing it at ~/Applications would wipe unrelated apps.
  targets.darwin = {
    linkApps.enable = false;
    copyApps.enable = true;
  };

  home = {
    # Surface Homebrew bins on PATH for interactive shells.
    # NOTE: launchd-spawned GUI apps don't read this — set per-agent envs
    # in their plist, or globally via `launchd.user.envVariables`
    # (nix-darwin scope, e.g. HERMES_HOME in modules/darwin/system/hermes.nix).
    sessionPath = [ "/opt/homebrew/bin" ];

    file.".orca/keybindings.json".text = builtins.toJSON {
      version = 1;
      keybindings = { };
      platforms = {
        darwin = {
          "terminal.clear" = [ ];
          "worktree.palette" = [ "Mod+K" ];
        };
        linux = { };
        win32 = { };
      };
    };

  };

  programs.zsh.initContent = lib.mkAfter ''
    # Homebrew (Apple Silicon)
    if [ -f /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi

    # Homebrew dependencies may surface their own moving python3. Keep the
    # interactive runtime aligned with the Nix-owned 3.13 tool baseline.
    export PATH="${pkgs.python313}/bin:$PATH"

    # Fix ECONNRESET errors in Claude Code on macOS.
    export NODE_OPTIONS="--dns-result-order=ipv4first"

    # Run Claude Code's harness against GPT-5.6 Sol through the local
    # CLIProxyAPI service without changing normal `claude` sessions.
    # ANTHROPIC_BASE_URL/AUTH_TOKEN go through --settings, not shell env: a
    # project .claude/settings(.local).json `env` block outranks the process
    # environment, so an inline env var here loses to any repo pinning a
    # different base URL (e.g. a local Headroom proxy). --settings is the
    # highest-precedence layer and wins from any working directory.
    claudex() {
      CLAUDE_CODE_SUBAGENT_MODEL="gpt-5.6-sol" \
      CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1 \
      CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=3 \
      ENABLE_TOOL_SEARCH=false \
        command claude \
          --settings '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:8317","ANTHROPIC_AUTH_TOKEN":"freecc"}}' \
          --model "gpt-5.6-sol" --effort high "$@"
    }

    # CLT-only installs do not expose the macOS SDK automatically. Native
    # extensions such as hnswlib need this path during compilation.
    export SDKROOT="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)"

    # Apply the declared state without discovering or upgrading remote packages.
    # --no-checks skips only the post-switch audit and advisory runtime checks.
    rebuild() {
      local skip_checks=false
      if [[ "''${1:-}" == "--no-checks" ]]; then
        skip_checks=true
        shift
      fi

      sudo darwin-rebuild switch --flake "$HOME/.dotfiles" "$@" || return $?

      if [[ "$skip_checks" == true ]]; then
        return 0
      fi

      local audit_output status_output audit_status status_status
      audit_output="$(mktemp "''${TMPDIR:-/tmp}/rebuild-audit.XXXXXX")" || return $?
      status_output="$(mktemp "''${TMPDIR:-/tmp}/rebuild-status.XXXXXX")" || {
        rm -f "$audit_output"
        return 1
      }

      "$HOME/.dotfiles/scripts/audit-system-discrepancies.sh" >"$audit_output" 2>&1 &
      local audit_pid=$!
      system-setup status --advisory >"$status_output" 2>&1 &
      local status_pid=$!

      audit_status=0
      wait "$audit_pid" || audit_status=$?
      status_status=0
      wait "$status_pid" || status_status=$?

      printf '\n==> System audit\n'
      cat "$audit_output"
      printf '\n==> System setup status\n'
      cat "$status_output"
      rm -f "$audit_output" "$status_output"

      (( audit_status == 0 && status_status == 0 ))
    }

    # Prepare reviewable repository updates without mutating the live system.
    update-system() {
      local dotfiles_root="$HOME/.dotfiles"

      (
        set -e
        cd "$dotfiles_root"
        nix flake update
        nix run .#github-sources -- update
        nix run .#github-sources -- verify
        ./scripts/uv-sources update
        nix flake check --no-build

        echo "Prepared system updates. Review with:"
        echo "  git -C \"$dotfiles_root\" diff -- flake.lock _sources/"
        echo "Apply when ready with: apply-system-update"
      )
    }

    # Apply prepared pins, update mutable package-manager declarations, then
    # publish only the repository-managed pin files.
    apply-system-update() {
      local dotfiles_root="$HOME/.dotfiles"

      (
        set -e
        cd "$dotfiles_root"
        sudo darwin-rebuild switch --flake "$dotfiles_root"
        # These helpers now come from the just-activated configuration, so
        # they use its declared Homebrew/npm/Bun package sets.
        update-homebrew
        update-npm-globals
        update-bun-globals
        update-agent-plugins
        "$dotfiles_root/scripts/audit-system-discrepancies.sh"

        if ! git diff --quiet HEAD -- flake.lock _sources/; then
          git add -- flake.lock _sources/
          git commit --only -m "chore: update system pins" -- flake.lock _sources/
          git push origin HEAD
        else
          echo "No system pin changes to commit."
        fi
      )
    }

    # Host surfaces Nix cannot manage: Determinate Nix (upgrade) and macOS
    # Software Update (list only — never silent OS installs).
    upgrade-out-of-band() {
      echo "==> Determinate Nix"
      if ! command -v determinate-nixd >/dev/null 2>&1; then
        echo "determinate-nixd not found; skip"
      else
        local determinate_status
        determinate_status="$(determinate-nixd status 2>&1 || true)"
        if printf '%s\n' "$determinate_status" | grep -qiE 'out of date|now available'; then
          echo "$determinate_status" | sed -n '1,6p'
          sudo determinate-nixd upgrade
        else
          echo "current ($(nix --version 2>/dev/null || echo unknown))"
        fi
      fi

      echo ""
      echo "==> macOS Software Update (advisory)"
      if ! command -v softwareupdate >/dev/null 2>&1; then
        echo "softwareupdate not found; skip"
        return 0
      fi

      local softwareupdate_out
      softwareupdate_out="$(softwareupdate -l 2>&1 || true)"
      local -a os_updates=()
      while IFS= read -r label; do
        [ -n "$label" ] && os_updates+=("$label")
      done < <(
        printf '%s\n' "$softwareupdate_out" |
          sed -nE 's/^[[:space:]]*\*[[:space:]]*Label:[[:space:]]*(.*)$/\1/p'
      )

      if [ "''${#os_updates[@]}" -gt 0 ]; then
        echo "pending:"
        local label
        for label in "''${os_updates[@]}"; do
          echo "  - $label"
        done
        echo "Install from System Settings → Software Update (not automated)."
        open "x-apple.systempreferences:com.apple.Software-Update-Settings.extension" 2>/dev/null || true
      elif printf '%s\n' "$softwareupdate_out" | grep -qiE 'No new software available|No updates'; then
        echo "none pending"
      else
        echo "could not determine (offline or deferred)"
      fi
    }

    # ========================================
    # HOMEBREW HELPERS (macOS only)
    # ========================================

    # Full drift audit (brew, npm, Bun, uv, nix, /Applications) — also runs
    # automatically after `rebuild`.
    brew-check() {
      "$HOME/.dotfiles/scripts/audit-system-discrepancies.sh"
    }

    # Install a cask and remind to add to config
    cask() {
      if [ "$1" = "add" ] && [ -n "$2" ]; then
        brew install --cask "$2"
        echo ""
        echo "Don't forget to add to ~/.dotfiles/modules/darwin/system/homebrew.nix:"
        echo ""
        echo "   casks = ["
        echo "     \"$2\""
        echo "     ..."
        echo "   ];"
      else
        echo "Usage: cask add <cask-name>"
        echo ""
        echo "This installs a cask and reminds you to add it to your config."
        echo "Run 'brew-check' to see all untracked casks."
      fi
    }
  '';

  # macOS-specific packages (if any)
  # home.packages = with pkgs; [ ];
}
