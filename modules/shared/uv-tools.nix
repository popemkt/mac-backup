{
  pkgs,
  lib,
  ...
}:

let
  # Declarative uv tool installs (global CLI tools via `uv tool install`).
  #
  # PyPI/git-sourced tools only — these are reproducible from this manifest.
  # Editable/local installs (e.g. browser-harness, which points at
  # ~/Developer/browser-harness) intentionally do NOT live here: they belong to
  # their own repos and can't be restored from a version string. The uv tool
  # *data* lives under ~/.local/share/uv (symlinked out via external-data.nix),
  # so it is machine-local and vanishes on a fresh machine — this list is what
  # makes the install intent reproducible.
  #
  # Audited by scripts/audit-system-discrepancies.sh (anchor: uvTools).
  #
  # headroom-ai[all] pulls hnswlib which requires C++ compile; fails on CLT-only
  # macOS setups without full Xcode SDK. The proxy daemon only needs the core
  # package — vector-search extras are unused at runtime.
  uvTools = [
    "headroom-ai"
  ];
in
{
  # Install declared uv tools during activation for cross-machine bootstrap.
  # Only installs tools that are missing; never force-reinstalls or upgrades,
  # so rebuilds stay predictable. Pinned versions are honoured on first install.
  home.activation.installUvTools = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    # CLT-only macOS doesn't set SDKROOT; without it clang can't find C++ stdlib
    # headers and any package with a C extension (hnswlib, etc.) fails to build.
    export SDKROOT="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
    for spec in ${lib.concatStringsSep " " (map lib.escapeShellArg uvTools)}; do
      name="''${spec%%==*}"
      name="''${name%%[*}"
      if ! ${pkgs.uv}/bin/uv tool list 2>/dev/null | ${pkgs.gnugrep}/bin/grep -q "^$name "; then
        $DRY_RUN_CMD ${pkgs.uv}/bin/uv tool install "$spec"
      fi
    done
  '';
}
