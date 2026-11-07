{ lib, pkgs, ... }:

# popemkt's own Home Manager choices, the same on every host they log in to.
# A person's folder selects; shared behavior lives under modules/.
{
  programs.git.settings.user = {
    name = "Hoang Nguyen Gia";
    email = "hoangng71299@gmail.com";
  };

  # Universal Control off: whenever a nearby Mac or iPad on the same Apple ID
  # connects, its AWDL sessions pull the Wi-Fi radio off the router's channel
  # and spike game ping (League: 11 ms -> 50-90 ms, router jitter to 300 ms;
  # traced 2026-11-07 to rapportd P2P client 'Ensemble'). The setting is
  # per-host, hence currentHostDefaults.
  targets.darwin.currentHostDefaults = lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
    "com.apple.universalcontrol".Disable = true;
  };
}
