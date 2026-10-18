{
  lib,
  sources,
  stdenvNoCC,
  bun,
  makeBinaryWrapper,
}:

# kb's release is one platform-independent bundle (popemkt/kb): the bun-built
# CLI and the UI's `dist` under `lib/kb`. This wraps that bundle's `cli.js`
# with nixpkgs' bun instead of running the tarball's own `bin/kb` launcher, so
# the runtime is a store path rather than whatever `bun` is on PATH. The
# wrapper sets KB_PKG_ROOT, so kb resolves `$out/lib/kb/packages/app/ui/dist`
# the same as a checkout does.
let
  source = sources.kb;
in
stdenvNoCC.mkDerivation {
  inherit (source) pname version src;

  nativeBuildInputs = [ makeBinaryWrapper ];

  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib" "$out/bin"
    cp -a lib/kb "$out/lib/kb"
    makeBinaryWrapper ${lib.getExe bun} "$out/bin/kb" \
      --set KB_PKG_ROOT "$out/lib/kb" \
      --add-flags "$out/lib/kb/cli.js"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    "$out/bin/kb" --version
    runHook postInstallCheck
  '';

  meta = {
    description = "Repo-native outliner datastore (CLI + browser UI)";
    inherit (source) homepage;
    mainProgram = "kb";
    platforms = lib.platforms.darwin ++ lib.platforms.linux;
  };
}
