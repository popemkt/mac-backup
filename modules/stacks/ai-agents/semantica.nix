{
  config,
  pkgs,
  lib,
  ...
}:

let
  inherit (config.my) username;
  semanticaVersion = config.my.uvPins."semantica".version;
  semanticaPython = "/Users/${username}/.local/share/uv/tools/semantica/bin/python";

  # Declarative uv tool installs owned by the Semantica boundary.
  # Contributed to my.pkgs.uvTools below so drift and update checks can read
  # the pin; the install itself stays here because it needs SDKROOT.
  uvTools = [
    # [explorer] ships the Knowledge Explorer workbench (semantica-explorer →
    # http://127.0.0.1:8000); the base install only provides the CLI/daemons.
    "semantica[explorer]==${semanticaVersion}"
  ];

  # uv's resolver mis-selects an ancient numba (0.53.1, py<=3.9 only) on
  # Python 3.12/3.13 for umap-learn's `numba>=0.51` — its llvmlite 0.36
  # cannot build there. Pinning numba>=0.60 forces the py3.13-compatible
  # resolution (numba 0.66 + llvmlite 0.48), which py3.10/3.11 pick naturally.
  numbaFloor = "numba>=0.60";
in
lib.mkIf config.my.stacks.ai-agents.enable {
  my.pkgs = { inherit uvTools; };

  home-manager.users.${username} =
    { lib, ... }:
    {
      # Reconcile both the pinned package and its interpreter. uv keeps the
      # dependency environment isolated, while Nix owns the Python version.
      # Heavy wheels (torch, faiss-cpu, opencv) are prebuilt for macOS arm64,
      # but native builds still need the Apple toolchain and SDKROOT.
      home.activation.installSemanticaUvTool = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        export SDKROOT="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
        export PATH="$PATH:/usr/bin:/bin"
        export CC=/usr/bin/clang
        export CXX=/usr/bin/clang++
        export AR=/usr/bin/ar
        export RANLIB=/usr/bin/ranlib
        export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=/usr/bin/clang

        if ! ${pkgs.uv}/bin/uv tool list 2>/dev/null \
            | ${pkgs.gnugrep}/bin/grep -q "^semantica v${semanticaVersion}$" \
          || [[ ! -x "${semanticaPython}" ]] \
          || [[ "$("${semanticaPython}" -c 'import platform; print(platform.python_version())' 2>/dev/null || true)" != "${pkgs.python313.version}" ]]
        then
          $DRY_RUN_CMD ${pkgs.uv}/bin/uv tool install \
            --force \
            --python ${pkgs.python313}/bin/python3 \
            --with ${lib.escapeShellArg numbaFloor} \
            ${lib.escapeShellArg (builtins.head uvTools)}
        fi
      '';
    };
}
