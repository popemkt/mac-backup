{
  lib,
  sources,
  stdenvNoCC,
  undmg,
}:

let
  source = sources.chat2db;
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
    description = "AI-powered database client and SQL workspace";
    homepage = "https://github.com/OtterMind/Chat2DB";
    # Modified Apache-2.0 (LicenseRef-Chat2DB): personal/internal use OK;
    # object-form redistribution to external parties needs commercial terms.
    license = lib.licenses.unfree;
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
