{ config, ... }:

let
  inherit (config.my) username;
  usInputSource = {
    InputSourceKind = "Keyboard Layout";
    "KeyboardLayout ID" = 0;
    "KeyboardLayout Name" = "U.S.";
  };
  vietnameseTelexInputSource = {
    InputSourceKind = "Input Mode";
    "Bundle ID" = "com.apple.inputmethod.VietnameseIM";
    "Input Mode" = "com.apple.inputmethod.VietnameseTelex";
  };
in
{
  system.defaults.CustomUserPreferences = {
    "com.apple.HIToolbox" = {
      AppleEnabledInputSources = [
        # Base Latin keyboard layout.
        usInputSource
        # Built-in Vietnamese Telex input method.
        vietnameseTelexInputSource
      ];
      AppleSelectedInputSources = [
        # Keep U.S. first so it remains the default selected layout.
        usInputSource
        # Make Vietnamese Telex visible in the input switcher.
        vietnameseTelexInputSource
      ];
      AppleInputSourceHistory = [
        # Mirror the selectable layouts so Text Input services rebuild their menu.
        usInputSource
        vietnameseTelexInputSource
      ];
    };
  };

  home-manager.users.${username} =
    { lib, ... }:
    {
      home.activation.enableVietnameseTelex = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
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
          /usr/bin/defaults write com.apple.HIToolbox AppleSelectedInputSources -array \
            '{ InputSourceKind = "Keyboard Layout"; "KeyboardLayout ID" = 0; "KeyboardLayout Name" = "U.S."; }' \
            '{ InputSourceKind = "Input Mode"; "Bundle ID" = "com.apple.inputmethod.VietnameseIM"; "Input Mode" = "com.apple.inputmethod.VietnameseTelex"; }'
          /usr/bin/defaults write com.apple.HIToolbox AppleInputSourceHistory -array \
            '{ InputSourceKind = "Keyboard Layout"; "KeyboardLayout ID" = 0; "KeyboardLayout Name" = "U.S."; }' \
            '{ InputSourceKind = "Input Mode"; "Bundle ID" = "com.apple.inputmethod.VietnameseIM"; "Input Mode" = "com.apple.inputmethod.VietnameseTelex"; }'
          /usr/bin/killall TextInputMenuAgent TextInputSwitcher SystemUIServer 2>/dev/null || true
        else
          echo "warning: failed to compile Vietnamese Telex input-source helper" >&2
        fi
      '';
    };
}
