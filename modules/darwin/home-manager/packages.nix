{ pkgs, ... }:

# Packages built for aarch64-darwin only (direct GitHub release pins in pkgs/).
{
  home.packages = with pkgs; [
    cursor-cli # Cursor terminal agent (`agent` / `cursor-agent`)
    vite-plus # Unified Vite-based web toolchain (`vp`)
    logseq # Logseq ARM64 app (stable GitHub release)
    chat2db # AI database client / SQL workspace (GitHub release DMG)
  ];
}
