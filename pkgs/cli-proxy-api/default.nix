{
  lib,
  sources,
  stdenvNoCC,
}:

let
  source = sources.cli-proxy-api;
in
stdenvNoCC.mkDerivation {
  inherit (source) pname version src;

  sourceRoot = ".";
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin"
    install -m755 cli-proxy-api "$out/bin/cli-proxy-api"

    runHook postInstall
  '';

  meta = {
    description = "OpenAI, Gemini, Claude, Codex, and Grok compatible API proxy";
    homepage = "https://github.com/router-for-me/CLIProxyAPI";
    license = lib.licenses.mit;
    mainProgram = "cli-proxy-api";
    platforms = [ "aarch64-darwin" ];
  };
}
