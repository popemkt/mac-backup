{
  lib,
  sources,
  stdenv,
  autoPatchelfHook,
  zlib,
}:

# SpacetimeDB's official Linux release: the `spacetime` CLI and the
# standalone server, prebuilt and glibc-dynamic, so autoPatchelf points them
# at the store's libstdc++ and zlib. nixpkgs has 2.10.1, built from source;
# axioms pins its module and SDKs to this release (pkgs/axioms).
let
  source = sources.spacetimedb;
in
stdenv.mkDerivation {
  inherit (source) pname version src;

  sourceRoot = ".";
  dontBuild = true;

  nativeBuildInputs = [ autoPatchelfHook ];
  buildInputs = [
    stdenv.cc.cc.lib
    zlib
  ];

  installPhase = ''
    runHook preInstall
    install -Dm755 spacetimedb-cli "$out/bin/spacetime"
    install -Dm755 spacetimedb-standalone "$out/bin/spacetimedb-standalone"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    "$out/bin/spacetime" --version
    "$out/bin/spacetimedb-standalone" --version
    runHook postInstallCheck
  '';

  meta = {
    description = "SpacetimeDB: a database that runs application logic and pushes changes to clients";
    inherit (source) homepage;
    license = lib.licenses.bsl11;
    mainProgram = "spacetime";
    platforms = [ "x86_64-linux" ];
  };
}
