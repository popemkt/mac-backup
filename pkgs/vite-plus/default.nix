{
  lib,
  sources,
  stdenvNoCC,
}:

let
  source = sources.vite-plus;
in
stdenvNoCC.mkDerivation {
  inherit (source) pname version src;

  sourceRoot = ".";
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin"
    install -m755 vp "$out/bin/vp"

    runHook postInstall
  '';

  meta = {
    description = "Vite+ - The Unified Toolchain for the Web";
    homepage = "https://viteplus.dev";
    license = lib.licenses.mit;
    mainProgram = "vp";
    platforms = [ "aarch64-darwin" ];
  };
}
