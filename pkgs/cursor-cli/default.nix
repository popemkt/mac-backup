{
  bash,
  lib,
  sources,
  stdenvNoCC,
}:

let
  source = sources.cursor-cli;
in
stdenvNoCC.mkDerivation {
  inherit (source) pname version src;

  sourceRoot = ".";
  dontBuild = true;

  installPhase = ''
        runHook preInstall

        mkdir -p "$out/bin" "$out/libexec"
        cp -R dist-package "$out/libexec/cursor-agent"
        patchShebangs "$out/libexec/cursor-agent/cursor-agent"

        for executable in agent cursor-agent; do
          cat > "$out/bin/$executable" <<EOF
    #!${bash}/bin/bash
    set -euo pipefail

    if [ "\''${1:-}" = update ]; then
      echo "Cursor CLI is managed by Nix; update the pin in ~/.dotfiles instead." >&2
      exit 2
    fi

    export CURSOR_INVOKED_AS="$executable"
    exec "$out/libexec/cursor-agent/cursor-agent" --disable-auto-update "\$@"
    EOF
          chmod 755 "$out/bin/$executable"
        done

        runHook postInstall
  '';

  meta = {
    description = "Command-line agent for Cursor";
    homepage = "https://cursor.com/";
    license = lib.licenses.unfree;
    mainProgram = "agent";
    platforms = [ "aarch64-darwin" ];
  };
}
