{
  config,
  lib,
  pkgs,
  ...
}:

# T3 Code on NixOS: one headless server per declared instance, run as its
# user. The servers and the agents they drive (Claude Code, Codex) come from
# npm, so they track the latest releases; npm ships them as prebuilt
# binaries, which run through nix-ld.
let
  cfg = config.my.stacks.t3-code;
in
{
  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = config.programs.nix-ld.enable;
        message = "my.stacks.t3-code needs programs.nix-ld.enable: t3, claude and codex are prebuilt npm binaries.";
      }
    ]
    ++ lib.mapAttrsToList (name: instance: {
      assertion = config.users.users ? ${instance.user};
      message = "my.stacks.t3-code.instances.${name}.user names ${instance.user}, which is not a declared account.";
    }) cfg.instances;

    # Installed per user by the npm executor (modules/common/home-manager/npm-global.nix).
    my.pkgs.npmGlobals = [
      "t3"
      "@anthropic-ai/claude-code"
      "@openai/codex"
    ];

    systemd.services = lib.mapAttrs' (
      name: instance:
      let
        inherit (config.users.users.${instance.user}) home;
      in
      lib.nameValuePair "t3-code-${name}" {
        description = "T3 Code server for ${instance.user}";
        wantedBy = [ "multi-user.target" ];
        wants = [ "network-online.target" ];
        # Home Manager's activation installs the npm globals this runs.
        after = [
          "network-online.target"
          "home-manager-${instance.user}.service"
        ];
        path = with pkgs; [
          bash
          coreutils
          git
          nodejs
        ];
        script = ''
          export PATH="${home}/.local/bin:$PATH"
          exec t3 serve --host 127.0.0.1 --port ${toString instance.port} --no-browser
        '';
        serviceConfig = {
          User = instance.user;
          WorkingDirectory = home;
          Restart = "on-failure";
          RestartSec = 10;
        };
      }
    ) cfg.instances;
  };
}
