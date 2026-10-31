{
  lib,
  sources,
  callPackage,
  rustPlatform,
  lld,
  pkg-config,
  openssl,
  makeBinaryWrapper,
  spacetimedb,
}:

# axioms (popemkt/axioms) at a release tag, built from source: the server and
# CLI, the web UI, and the SpacetimeDB module it publishes. Its main program,
# `axioms-live`, publishes that module and then serves, so the module the
# database runs is always the one the server and UI were built with
# (./live.nix). The database itself is pkgs/axioms-db.
let
  source = sources.axioms;
  # The pin is the tag (nvfetcher.toml → axioms).
  version = lib.removePrefix "v" source.version;

  # The SpacetimeDB module: its own crate and lock under spacetime/, built for
  # wasm32 (nixpkgs' rustc ships that std; lld links it).
  module = rustPlatform.buildRustPackage {
    pname = "axioms-module";
    inherit version;
    inherit (source) src;
    cargoRoot = "spacetime";
    # Both hashes belong to the pinned tag (nvfetcher.toml → axioms).
    cargoHash = "sha256-Jixa3hvtz1oCGNymINvbjpq3lwBkcyYSTi+4LwW/uSY=";
    nativeBuildInputs = [ lld ];
    buildPhase = ''
      runHook preBuild
      cargo build --offline --release -j "$NIX_BUILD_CORES" \
        --manifest-path spacetime/Cargo.toml --target wasm32-unknown-unknown
      runHook postBuild
    '';
    doCheck = false;
    installPhase = ''
      runHook preInstall
      install -Dm444 spacetime/target/wasm32-unknown-unknown/release/axioms_module.wasm \
        "$out/axioms.wasm"
      runHook postInstall
    '';
  };

  axioms = rustPlatform.buildRustPackage {
    inherit version;
    inherit (source) pname src;
    cargoHash = "sha256-CKE1sWQPafBno64a7IR0Lfmf2wskPkL0gOBlno2TWk4=";
    cargoBuildFlags = [
      "-p"
      "axioms-server"
      "-p"
      "axioms-cli"
    ];
    # The repository's own gate (scripts/check.sh) runs the tests on every
    # commit; the release build only packages them.
    doCheck = false;
    nativeBuildInputs = [
      pkg-config
      makeBinaryWrapper
    ];
    buildInputs = [ openssl ];
    postInstall = ''
      mkdir -p "$out/share/axioms"
      cp -r web "$out/share/axioms/web"
      install -Dm444 ${module}/axioms.wasm "$out/share/axioms/axioms.wasm"
      wrapProgram "$out/bin/axioms-server" --set-default AXIOMS_WEB "$out/share/axioms/web"
    '';
    meta.mainProgram = "axioms-server";
  };

  live = callPackage ./live.nix { inherit axioms spacetimedb; };
in
live.overrideAttrs (old: {
  passthru = (old.passthru or { }) // {
    inherit axioms module;
  };
  meta = (old.meta or { }) // {
    description = "Learn any topic from what you already know: a needs graph down to your axioms";
    homepage = "https://github.com/popemkt/axioms";
    license = lib.licenses.mit;
    mainProgram = "axioms-live";
    platforms = [ "x86_64-linux" ];
  };
})
