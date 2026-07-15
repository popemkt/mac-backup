{ config, ... }:

let
  inherit (config.my) username;
in
{
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

            // Selecting Telex once makes macOS surface it in the input switcher;
            // selecting U.S. afterward preserves U.S. as the default.
            selectSource(@"com.apple.inputmethod.VietnameseIM.VietnameseTelex");
            selectSource(@"com.apple.keylayout.US");
          }
          return 0;
        }
        EOF

        if /usr/bin/clang -framework Carbon -framework Foundation "$tmpdir/enable-vietnamese-telex.m" -o "$tmpdir/enable-vietnamese-telex"; then
          "$tmpdir/enable-vietnamese-telex"
          /usr/bin/defaults write com.apple.TextInputMenu visible -bool true
          /usr/bin/killall TextInputMenuAgent TextInputSwitcher SystemUIServer 2>/dev/null || true
        else
          echo "warning: failed to compile Vietnamese Telex input-source helper" >&2
        fi
      '';
    };
}
