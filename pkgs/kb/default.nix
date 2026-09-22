{
  lib,
  stdenvNoCC,
  bun,
  bun2nix,
  makeBinaryWrapper,
}:

# Single entry point: one `kb` binary with the SPA baked beside it.
# Operator never minds KB_UI_DIST — the wrapper sets KB_PKG_ROOT so
# paths.ts resolves `$out/lib/kb/packages/app/ui/dist` the same as a checkout.
#
# Dependencies come from tools/kb/bun.nix, which bun2nix generates from
# bun.lock (kb's `postinstall`; its harness fails a stale copy). Each package
# is fetched against the hash the lockfile already records, and the build
# itself is an ordinary offline derivation — so no hash here tracks kb's own
# code, and editing kb never needs a hash refresh.
stdenvNoCC.mkDerivation {
  pname = "kb";
  version = "0.1.0";

  src = lib.cleanSourceWith {
    src = ../../tools/kb;
    filter =
      path: _type:
      !(builtins.elem (baseNameOf path) [
        "node_modules"
        "dist"
        "out"
        ".source-hash"
      ]);
  };

  nativeBuildInputs = [
    bun
    bun2nix.hook
    makeBinaryWrapper
  ];

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ../../tools/kb/bun.nix;
  };

  # The hook installs node_modules from bunDeps; building and installing are
  # kb's own two artifacts, below.
  dontUseBunBuild = true;
  dontUseBunCheck = true;
  dontUseBunInstall = true;

  buildPhase = ''
    runHook preBuild
    (cd packages/app/ui && bun run build)
    bun build ./packages/app/cli/src/main.ts \
      --outdir="$TMPDIR/bundle" \
      --target=bun \
      --sourcemap=none
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/kb/packages/app/ui" "$out/bin"
    cp -a "$TMPDIR/bundle/main.js" "$out/lib/kb/cli.js"
    cp -a packages/app/ui/dist "$out/lib/kb/packages/app/ui/dist"
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
