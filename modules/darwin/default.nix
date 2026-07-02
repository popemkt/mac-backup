{ lib, ... }:

{
  # ============================================================================
  # DARWIN-SPECIFIC HOME-MANAGER SETTINGS
  # ============================================================================

  home = {
    # Surface Homebrew bins on PATH for interactive shells.
    # NOTE: launchd-spawned GUI apps don't read this — set per-agent envs
    # in their plist, or globally via `launchd.user.envVariables`
    # (nix-darwin scope, e.g. HERMES_HOME in hosts/darwin/default.nix).
    sessionPath = [ "/opt/homebrew/bin" ];

    file.".mackup.cfg".text = ''
      [storage]
      engine = icloud

      [applications_to_sync]
      alt-tab
      karabiner-elements
      warp
      zed
      vscode
      telegram_macos
      claude-code
      macosx
    '';

    sessionVariables = {
      # Hermes auxiliary ACP uses the Homebrew Copilot CLI on macOS.
      HERMES_COPILOT_ACP_COMMAND = "/opt/homebrew/bin/copilot";

      # Mirrors launchd.user.envVariables.HERMES_HOME (hosts/darwin/default.nix).
      # Launchd line covers GUI apps; this covers interactive shells where
      # the launchd setenv lands in the wrong bootstrap domain at activate-time.
      HERMES_HOME = "/stuff/workspace/repos/_brain/.agents/hermes/profile/popemkt";
    };

    activation.enableVietnameseTelex = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
      tmpdir="$(/usr/bin/mktemp -d)"
      trap '/bin/rm -rf "$tmpdir"' EXIT

      /bin/cat > "$tmpdir/enable-vietnamese-telex.m" <<'EOF'
      #import <Carbon/Carbon.h>
      #import <Foundation/Foundation.h>

      static TISInputSourceRef findSource(NSString *sourceID) {
        CFArrayRef sources = TISCreateInputSourceList(NULL, true);
        if (!sources) return NULL;

        TISInputSourceRef match = NULL;
        CFIndex count = CFArrayGetCount(sources);
        for (CFIndex i = 0; i < count; i++) {
          TISInputSourceRef source = (TISInputSourceRef)CFArrayGetValueAtIndex(sources, i);
          NSString *candidate = (__bridge NSString *)TISGetInputSourceProperty(source, kTISPropertyInputSourceID);
          if ([candidate isEqualToString:sourceID]) {
            match = source;
            CFRetain(match);
            break;
          }
        }

        CFRelease(sources);
        return match;
      }

      static void enableSource(NSString *sourceID) {
        TISInputSourceRef source = findSource(sourceID);
        if (source) {
          TISEnableInputSource(source);
          CFRelease(source);
        }
      }

      static void selectSource(NSString *sourceID) {
        TISInputSourceRef source = findSource(sourceID);
        if (source) {
          TISSelectInputSource(source);
          CFRelease(source);
        }
      }

      static void disableSource(NSString *sourceID) {
        TISInputSourceRef source = findSource(sourceID);
        if (source) {
          TISDisableInputSource(source);
          CFRelease(source);
        }
      }

      int main(void) {
        @autoreleasepool {
          // Telex is the selectable source, but its non-selectable parent input
          // method must stay enabled or macOS hides all Vietnamese input modes.
          enableSource(@"com.apple.inputmethod.VietnameseIM.VietnameseTelex");
          enableSource(@"com.apple.inputmethod.VietnameseIM");
          enableSource(@"com.apple.keylayout.US");

          disableSource(@"com.apple.keylayout.Vietnamese");
          disableSource(@"com.apple.inputmethod.VietnameseIM.VietnameseSimpleTelex");
          disableSource(@"com.apple.inputmethod.VietnameseIM.VietnameseVNI");
          disableSource(@"com.apple.inputmethod.VietnameseIM.VietnameseVIQR");
          selectSource(@"com.apple.keylayout.US");
        }
        return 0;
      }
      EOF

      if /usr/bin/clang -framework Carbon -framework Foundation "$tmpdir/enable-vietnamese-telex.m" -o "$tmpdir/enable-vietnamese-telex"; then
        "$tmpdir/enable-vietnamese-telex"
        /usr/bin/killall TextInputMenuAgent TextInputSwitcher SystemUIServer 2>/dev/null || true
      else
        echo "warning: failed to compile Vietnamese Telex input-source helper" >&2
      fi
    '';
  };

  # macOS-specific shell additions
  programs.zsh.shellAliases = {
    # Nix rebuild alias (darwin-specific). No #attr — darwin-rebuild picks
    # darwinConfigurations.<hostname> at runtime, and networking.* keeps the
    # hostname synced to the flake attr. Only a machine RENAME needs an
    # explicit one-off: sudo darwin-rebuild switch --flake ~/.dotfiles#<newname>
    rebuild = "sudo darwin-rebuild switch --flake ~/.dotfiles";
  };

  programs.zsh.initContent = lib.mkAfter ''
    # ========================================
    # HOMEBREW HELPERS (macOS only)
    # ========================================

    # Show casks installed but not in your nix config
    brew-check() {
      echo "Checking for untracked casks..."
      echo ""

      local config_file="$HOME/.dotfiles/hosts/darwin/default.nix"
      local installed=$(brew list --cask 2>/dev/null | sort)
      local configured=$(grep -v '^\s*#' "$config_file" | grep -oE '"[a-zA-Z0-9-]+"' | tr -d '"' | sort | uniq)

      local untracked=$(echo "$installed" | while read -r cask; do
        echo "$configured" | grep -q "^$cask$" || echo "$cask"
      done)

      if [ -z "$untracked" ]; then
        echo "All casks are tracked in config!"
      else
        echo "Untracked casks (installed but not in config):"
        echo ""
        echo "$untracked" | while read -r cask; do
          echo "   $cask"
        done
        echo ""
        echo "Add them to: $config_file"
      fi
    }

    # Install a cask and remind to add to config
    cask() {
      if [ "$1" = "add" ] && [ -n "$2" ]; then
        brew install --cask "$2"
        echo ""
        echo "Don't forget to add to ~/.dotfiles/hosts/darwin/default.nix:"
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
