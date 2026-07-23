{
  config,
  lib,
  pkgs,
  ...
}:

let
  inherit (config.my) hostname role username;
  inherit (lib) mapAttrsToList optionals;

  home = "/Users/${username}";
  aiCfg = config.my.stacks.ai-agents;
  vpnCfg = config.my.stacks.vpn;
  cogneeServer = aiCfg.enable && aiCfg.cognee.server.enable;
  cogneeClient = aiCfg.enable && aiCfg.cognee.client.enable;

  tailscaleDevice = {
    id = "tailscale-device";
    name = "Tailscale device identity";
    description = "Enroll this Mac in the configured tailnet.";
    required = vpnCfg.enable;
    required_by = [ "Private service connectivity" ];
    depends_on = [ ];
    check.kind = "tailscale_device";
    enrollment = {
      kind = "command";
      instructions = "Authenticate this Mac with Tailscale in the interactive browser flow.";
      argv = [
        "/usr/local/bin/tailscale"
        "login"
      ];
    };
    state_paths = [ ];
    secret_policy = "Tailscale owns the device key; never copy it into Git.";
    recovery = "Sign in again, then restore the declared machine tag in the admin console.";
  };

  tailscaleServices = mapAttrsToList (name: service: {
    id = "tailscale-service-${name}";
    name = "Tailscale service: svc:${name}";
    description = "Define and advertise the stable ${name} Tailnet Service endpoint.";
    required = service.advertised;
    required_by = [ "https://${name}.${vpnCfg.tailnetDomain}" ];
    depends_on = [ "tailscale-device" ];
    check = {
      kind = "tailscale_service";
      service = "svc:${name}";
      inherit (service) target;
    };
    enrollment = {
      kind = "manual";
      instructions = ''
        Create svc:${name} once in the Tailscale Services console if it does not exist.
        Then reapply the tracked policy; its auto-approver attaches tagged host ${hostname}.
      '';
      url = "https://console.tailscale.com/admin/services";
    };
    state_paths = [ ];
    secret_policy = "The Service identity and host approval remain Tailscale control-plane state.";
    recovery = "Recreate svc:${name}, reapply the tracked policy, and rebuild this host.";
  }) vpnCfg.services;

  cliProxyAntigravity = {
    id = "cli-proxy-antigravity";
    name = "CLIProxyAPI Antigravity OAuth";
    description = "Expose the Gemini model Cognee uses through the local OpenAI-compatible proxy.";
    required = cogneeServer;
    required_by = if cogneeServer then [ "Cognee generation" ] else [ "Claudex (optional)" ];
    depends_on = [ ];
    check = {
      kind = "openai_models";
      url = "http://127.0.0.1:8317/v1/models";
      expected_models = [ "gemini-3.5-flash-low" ];
    };
    enrollment = {
      kind = "command";
      instructions = ''
        Authenticate Antigravity inside CLIProxyAPI. This is separate from the agy CLI login.
      '';
      argv = [
        "${pkgs.cli-proxy-api}/bin/cli-proxy-api"
        "-config"
        "${home}/.config/cli-proxy-api/config.yaml"
        "-antigravity-login"
      ];
    };
    state_paths = [ "${home}/.local/share/cli-proxy-api" ];
    secret_policy = "OAuth refresh state is mutable secret material and must not enter Git.";
    recovery = "Run this enrollment again or restore the auth directory from an encrypted backup.";
  };

  cogneeService = {
    id = "cognee-server";
    name = "Cognee backend";
    description = "Verify the local authenticated Cognee API and its generation dependency.";
    required = true;
    required_by = [ "Shared knowledge service" ];
    depends_on = [
      "tailscale-service-cognee"
      "cli-proxy-antigravity"
    ];
    check = {
      kind = "http_json";
      url = "http://127.0.0.1:8088/health";
      expected = {
        status = "ready";
        health = "healthy";
      };
      success_detail = "local Cognee API is healthy";
    };
    enrollment = {
      kind = "none";
      instructions = "Cognee is installed and supervised by Nix; rebuild and inspect cognee-status.";
    };
    state_paths = [
      "${home}/.local/share/cognee/data"
      "${home}/.local/share/cognee/system"
      "${home}/.local/state/cognee/secrets.env"
    ];
    secret_policy = "Generated secrets remain mode 0600; databases and secrets require backup.";
    recovery = "Restore Cognee state and secrets together while its services are stopped.";
  };

  cogneeAgents = {
    id = "cognee-agent-integrations";
    name = "Cognee agent enrollment";
    description = "Provision the private agent API key and configure supported agent clients.";
    required = true;
    required_by = [ "Codex, Claude Code, Cursor, OMP, and Hermes memory" ];
    depends_on = [ "cognee-server" ];
    check = {
      kind = "file";
      path = "${home}/.local/state/cognee/agent-api-key";
      success_detail = "agent integration key is provisioned";
    };
    enrollment = {
      kind = "command";
      instructions = "Provision or validate the shared Cognee agent key and client integrations.";
      argv = [ "cognee-agent-setup" ];
    };
    state_paths = [ "${home}/.local/state/cognee/agent-api-key" ];
    secret_policy = "The generated API key stays outside Git and is backed up as protected state.";
    recovery = "Run cognee-agent-setup; rotate and revoke the old key if compromise is suspected.";
  };

  cogneeRemoteClient = {
    id = "cognee-client";
    name = "Cognee remote client";
    description = "Verify the central service, per-machine key, and local MCP bridge.";
    required = true;
    required_by = [ "Remote agent memory" ];
    depends_on = [ "tailscale-device" ];
    check = {
      kind = "command";
      argv = [ "cognee-client-status" ];
      timeout_seconds = 30;
      success_detail = "Cognee client is enrolled and its MCP bridge is running";
    };
    enrollment = {
      kind = "command";
      instructions = "Create a distinct per-machine Cognee API key and configure local agents.";
      argv = [ "cognee-client-enroll" ];
    };
    state_paths = [ "${home}/.local/state/cognee/agent-api-key" ];
    secret_policy = "The per-machine key stays mode 0600 and must not enter Git or agent config.";
    recovery = "Re-enroll with --replace and revoke the superseded key in Cognee.";
  };

  integrations =
    optionals vpnCfg.enable ([ tailscaleDevice ] ++ tailscaleServices)
    ++ optionals aiCfg.enable [ cliProxyAntigravity ]
    ++ optionals cogneeServer [
      cogneeService
      cogneeAgents
    ]
    ++ optionals cogneeClient [ cogneeRemoteClient ];

  manifest = pkgs.writeText "system-setup-integrations.json" (
    builtins.toJSON {
      schema_version = 1;
      host = {
        name = hostname;
        inherit role;
      };
      inherit integrations;
    }
  );
in
{
  assertions = [
    {
      assertion = !cogneeServer || builtins.hasAttr "cognee" vpnCfg.services;
      message = "The Cognee server requires my.stacks.vpn.services.cognee.";
    }
  ];

  environment.etc."system-setup/integrations.json".source = manifest;

  home-manager.users.${username}.home.packages = [ pkgs.system-setup ];
}
