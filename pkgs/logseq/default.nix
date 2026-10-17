{
  lib,
  sources,
  stdenvNoCC,
  unzip,
}:

let
  source = sources.logseq;
in
stdenvNoCC.mkDerivation {
  inherit (source) pname version src;

  nativeBuildInputs = [ unzip ];
  dontUnpack = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p extracted "$out/Applications"
    unzip -q "$src" -d extracted
    cp -R extracted/Logseq.app "$out/Applications/Logseq.app"

    runHook postInstall
  '';

  meta = {
    description = "Privacy-first platform for knowledge sharing and management";
    homepage = "https://github.com/logseq/logseq/releases";
    license = lib.licenses.agpl3Only;
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
