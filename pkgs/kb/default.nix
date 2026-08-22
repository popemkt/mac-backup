{
  lib,
  stdenvNoCC,
  bun,
  makeBinaryWrapper,
}:

# Single entry point: one `kb` binary with the SPA baked beside it.
# Operator never minds KB_UI_DIST — the wrapper sets KB_PKG_ROOT so
# paths.ts resolves `$out/lib/kb/ui/dist` the same as a checkout layout.
#
# UI and CLI bundles are fixed-output derivations (network for bun install).
# Unchanged inputs → same output hash → Nix reuses the store path.
let
  version = "0.1.0";

  src = lib.cleanSourceWith {
    src = ../../tools/kb;
    filter =
      path: type:
      let
        base = baseNameOf path;
      in
      !(builtins.elem base [
        "node_modules"
        "dist"
        ".source-hash"
      ]);
  };

  # FOD: install + vp build → SPA only.
  uiDist = stdenvNoCC.mkDerivation {
    name = "kb-ui-dist-${version}";
    inherit src;
    nativeBuildInputs = [ bun ];
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-jtnZUIUcBsInNdZ9axLGI32d3sc2PjXUxzrozxyEvP0=";
    dontConfigure = true;
    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      # Root install: vite aliases @kb/protocol|canvas → ../src, which import zod etc.
      bun install --frozen-lockfile
      (
        cd ui
        bun install --frozen-lockfile
        bun run build
      )
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -a ui/dist/. "$out/"
      runHook postInstall
    '';
  };

  # FOD: install CLI deps + bun-bundle to one JS file (deps inlined).
  cliJs = stdenvNoCC.mkDerivation {
    name = "kb-cli-js-${version}";
    inherit src;
    nativeBuildInputs = [ bun ];
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-rSSnIzuqAWkoDnfoIYXcC/vHKsJLHp0XX267A6uyy7Y=";
    dontConfigure = true;
    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      bun install --frozen-lockfile
      mkdir -p "$TMPDIR/bundle"
      bun build ./src/surface/cli.ts \
        --outdir="$TMPDIR/bundle" \
        --target=bun \
        --sourcemap=none
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -a "$TMPDIR/bundle/cli.js" "$out/cli.js"
      runHook postInstall
    '';
  };
in
stdenvNoCC.mkDerivation {
  pname = "kb";
  inherit version;

  nativeBuildInputs = [ makeBinaryWrapper ];

  # Pure assembly from FODs — offline.
  dontUnpack = true;
  dontConfigure = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/kb/ui" "$out/bin"
    cp -a ${cliJs}/cli.js "$out/lib/kb/cli.js"
    cp -a ${uiDist} "$out/lib/kb/ui/dist"
    makeBinaryWrapper ${lib.getExe bun} "$out/bin/kb" \
      --set KB_PKG_ROOT "$out/lib/kb" \
      --add-flags "$out/lib/kb/cli.js"
    runHook postInstall
  '';

  meta = {
    description = "Repo-native outliner datastore (CLI + browser UI)";
    mainProgram = "kb";
    platforms = lib.platforms.darwin;
  };
}
