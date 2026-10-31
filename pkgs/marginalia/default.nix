{
  lib,
  stdenvNoCC,
  fetchurl,
  versionCheckHook,
}:

# Marginalia (bytetum/marginalia): one static musl binary, from a release tarball
# whose top directory is `marginalia-<version>/` (bin/marginalia, README.md,
# deploy/). Being static, it needs no patchelf and no shared library.
#
# This pin is bumped BY HAND, not by nvfetcher: there is no entry for it in
# nvfetcher.toml, no update bot, and nothing under _sources/. To move it:
#
#   1. Edit `version` below to the release (the tag without its leading `v`).
#   2. Get the new hash from the tarball URL, `url` below with that version:
#        nix store prefetch-file <url>
#      and put the `Hash:` it prints in `hash`.
#   3. `rebuild`; the unit names the program by store path, so the new package
#      restarts app-marginalia-bytetum (configs/specs/app-service-contract.md).
#
# A manual pin is safe because bytetum/marginalia never prunes its releases,
# nightlies included. kb does (popemkt/kb deletes nightlies after 14 days),
# which is why kb's pin needs a bot that keeps moving it.
let
  version = "0.1.1-nightly.20261030155926";
  hash = "sha256-uJe8rcoaEHOJk4yiMFipNPJoonpagOzxGaJlIrh19Nk=";
in
stdenvNoCC.mkDerivation {
  pname = "marginalia";
  inherit version;

  src = fetchurl {
    url = "https://github.com/bytetum/marginalia/releases/download/v${version}/marginalia-${version}-x86_64-linux.tar.gz";
    inherit hash;
  };

  dontBuild = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 bin/marginalia "$out/bin/marginalia"
    runHook postInstall
  '';

  # `marginalia --version` must report the pinned version, so a hash that
  # fetches the wrong release fails the build rather than running.
  doInstallCheck = true;
  nativeInstallCheckInputs = [ versionCheckHook ];

  meta = {
    description = "Personal reading library with an agent, REST and MCP";
    homepage = "https://github.com/bytetum/marginalia";
    mainProgram = "marginalia";
    platforms = [ "x86_64-linux" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
