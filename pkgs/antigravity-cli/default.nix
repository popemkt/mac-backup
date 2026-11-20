{
  lib,
  sources,
  stdenv,
  autoPatchelfHook,
}:

# Google Antigravity CLI (`agy`), Linux x86_64 release tarball. The upstream
# binary is dynamically linked against glibc only, so autoPatchelfHook points
# its ELF interpreter and rpath at the store's glibc without needing nix-ld or
# extra shared libraries. Installed directly at $out/bin/agy so /proc/self/exe
# stays accurate for `agy acp --worker`.
let
  source = sources.antigravity-cli;
in
stdenv.mkDerivation {
  inherit (source) pname version src;

  sourceRoot = ".";
  dontBuild = true;
  dontStrip = true;

  nativeBuildInputs = [ autoPatchelfHook ];

  installPhase = ''
    runHook preInstall
    install -Dm755 antigravity "$out/bin/agy"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    "$out/bin/agy" --version
    runHook postInstallCheck
  '';

  meta = {
    description = "Google Antigravity CLI (agy)";
    homepage = "https://antigravity.google/";
    license = lib.licenses.unfree;
    mainProgram = "agy";
    platforms = [ "x86_64-linux" ];
  };
}
