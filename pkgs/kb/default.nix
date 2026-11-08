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
#
# Bun auto-loads `.env` and `bunfig.toml` from the working directory, so kb
# started inside a hostile clone would take that clone's environment (e.g. a
# forged KB_DATA trust ledger) and run its bunfig `preload` before kb's own
# code. kb's launch contract is the Bun flags in the release's
# `lib/kb/launch-flags`; the wrapper passes exactly those, before `cli.js`,
# and kb's `cli.js` exits 78 when started with any other flags.
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
    launchFlags=$(tr '\n' ' ' < lib/kb/launch-flags)
    makeBinaryWrapper ${lib.getExe bun} "$out/bin/kb" \
      --set KB_PKG_ROOT "$out/lib/kb" \
      --add-flags "$launchFlags $out/lib/kb/cli.js"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    "$out/bin/kb" --version
    # The launch flags must stop a working directory's .env and bunfig.toml.
    probe=$(mktemp -d)
    printf 'KB_DATA=/forged\n' > "$probe/.env"
    printf 'preload = ["./preload.js"]\n' > "$probe/bunfig.toml"
    echo 'throw new Error("bunfig preload ran")' > "$probe/preload.js"
    (cd "$probe" && "$out/bin/kb" --version)
    rm -rf "$probe"
    runHook postInstallCheck
  '';

  meta = {
    description = "Repo-native outliner datastore (CLI + browser UI)";
    inherit (source) homepage;
    mainProgram = "kb";
    platforms = lib.platforms.darwin ++ lib.platforms.linux;
  };
}
