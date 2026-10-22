# The shared libraries a prebuilt Chromium needs (`ldd` on it), as nixpkgs
# attribute names for the my.pkgs.nixLdLibraries channel: Playwright's full
# Chromium and its headless shell, which T3's built-in browser and kb's render
# tests both run through nix-ld. The headless shell needs a subset; cairo,
# cups and pango are the full browser's. at-spi2-core carries atk, atk-bridge
# and atspi. Chromium bundles its own Vulkan loader, which finds the GPU
# drivers through /etc/vulkan (modules/nixos/system/default.nix);
# vulkan-loader serves prebuilt binaries that do not bundle one.
[
  "alsa-lib"
  "at-spi2-core"
  "cairo"
  "cups"
  "dbus"
  "expat"
  "glib"
  "libgbm"
  "libx11"
  "libxcb"
  "libxcomposite"
  "libxdamage"
  "libxext"
  "libxfixes"
  "libxkbcommon"
  "libxrandr"
  "nspr"
  "nss"
  "pango"
  "systemdLibs"
  "vulkan-loader"
]
