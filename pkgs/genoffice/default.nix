{
  lib,
  sources,
  stdenvNoCC,
  undmg,
}:

let
  source = sources.genoffice;
in
stdenvNoCC.mkDerivation {
  inherit (source) pname version src;

  nativeBuildInputs = [ undmg ];
  sourceRoot = ".";
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/Applications"
    cp -R *.app "$out/Applications/"

    runHook postInstall
  '';

  meta = {
    description = "AI-native office suite for docs, sheets, slides, and PDF";
    homepage = "https://github.com/genspark-ai/genoffice";
    license = lib.licenses.asl20;
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
