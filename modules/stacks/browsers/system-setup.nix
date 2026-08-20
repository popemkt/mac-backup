{
  config,
  lib,
  pkgs,
  ...
}:

# Ensure declared browser-extension repos exist under /stuff so operators can
# Load unpacked in the Chromium profiles they choose. Never writes browser
# Preferences — enrollment stops at a stable checkout path.
let
  inherit (lib) mkIf;
  cfg = config.my.stacks.browsers;

  repoRoot = "/stuff/workspace/repos/chrome-new-tab";
  extensionRoot = "${repoRoot}/dist";
  manifestPath = "${extensionRoot}/manifest.json";
  remote = "https://github.com/popemkt/chrome-new-tab.git";

  enrollChromeNewTab = pkgs.writeShellScript "enroll-chrome-new-tab" ''
    set -euo pipefail

    repo=${lib.escapeShellArg repoRoot}
    remote=${lib.escapeShellArg remote}
    manifest=${lib.escapeShellArg manifestPath}
    git=${lib.escapeShellArg "${pkgs.git}/bin/git"}
    pnpm=${lib.escapeShellArg "${pkgs.pnpm}/bin/pnpm"}

    if [ ! -d /stuff/workspace ]; then
      echo "error: /stuff/workspace missing; mount the Data volume (see external-workspace)" >&2
      exit 1
    fi

    if [ -e "$repo" ]; then
      if [ -f "$manifest" ]; then
        echo "already present: $repo"
        exit 0
      fi
      if [ ! -f "$repo/package.json" ]; then
        echo "error: $repo exists but is not a chrome-new-tab checkout" >&2
        exit 1
      fi
    else
      mkdir -p /stuff/workspace/repos
      "$git" clone "$remote" "$repo"
      echo "cloned $remote"
    fi

    cd "$repo"
    "$pnpm" install --frozen-lockfile
    "$pnpm" build
    if [ ! -f "$manifest" ]; then
      echo "error: build succeeded but $manifest is missing" >&2
      exit 1
    fi
    echo "Load unpacked from: ${extensionRoot}"
  '';
in

{
  config = mkIf cfg.enable {
    my.systemSetup = {
      components."chrome-new-tab-repo" = {
        name = "chrome-new-tab checkout";
        description = "Stable workspace clone of the New Tab URL Redirector extension.";
        managedBy = "hybrid";
      };

      integrations."chrome-new-tab" = {
        name = "chrome-new-tab extension repo";
        description = "Clone the unpacked extension under /stuff so browsers can Load unpacked from a stable path.";
        requiredBy = [ "New Tab URL Redirector (unpacked)" ];
        connections = [
          {
            source = "local-host";
            target = "chrome-new-tab-repo";
          }
        ];
        check = {
          kind = "file";
          path = manifestPath;
          success_detail = "checkout present at ${repoRoot}";
        };
        enrollment = {
          kind = "command";
          instructions = ''
            Enroll chrome-new-tab into ${repoRoot} (requires /stuff mounted);
            enrollment installs dependencies and builds the unpacked extension.
            Then in each Chromium browser you want: chrome://extensions →
            Developer mode → Load unpacked → ${extensionRoot}.
          '';
          argv = [ "${enrollChromeNewTab}" ];
        };
        statePaths = [ repoRoot ];
        secretPolicy = "Public GitHub clone; no credentials in the Nix store.";
        recovery = "Remove a broken checkout if needed, then system-setup enroll chrome-new-tab; or restore the repo from workspace backup.";
      };
    };
  };
}
