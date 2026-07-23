{
  config,
  lib,
  pkgs,
  ...
}:

let
  inherit (config.my) username;
  inherit (lib) mkIf mkMerge;
  home = "/Users/${username}";
  aiCfg = config.my.stacks.ai-agents;
  vpnCfg = config.my.stacks.vpn;
  cogneeServer = aiCfg.enable && aiCfg.cognee.server.enable;
  cogneeClient = aiCfg.enable && aiCfg.cognee.client.enable;
in

{
  config = mkMerge [
    (mkIf aiCfg.enable {
      my.systemSetup = {
        components = {
          "cli-proxy-api" = {
            name = "CLIProxyAPI";
            description = "Local OpenAI-compatible gateway to authenticated model providers.";
            managedBy = "hybrid";
          };

          antigravity = {
            name = "Antigravity";
            description = "Externally authenticated Gemini model provider.";
            managedBy = "external";
          };
        };

        integrations."cli-proxy-antigravity" = {
          name = "CLIProxyAPI Antigravity OAuth";
          description = "Prove CLIProxyAPI can expose the Gemini model used by Cognee.";
          required = cogneeServer;
          requiredBy = if cogneeServer then [ "Cognee generation" ] else [ "Claudex (optional)" ];
          connections = [
            {
              source = "cli-proxy-api";
              target = "antigravity";
            }
          ];
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
          statePaths = [ "${home}/.local/share/cli-proxy-api" ];
          secretPolicy = "OAuth refresh state is mutable secret material and must not enter Git.";
          recovery = "Run this enrollment again or restore the auth directory from an encrypted backup.";
        };
      };
    })

    (mkIf cogneeServer {
      assertions = [
        {
          assertion = builtins.hasAttr "cognee" vpnCfg.services;
          message = "The Cognee server requires my.stacks.vpn.services.cognee.";
        }
      ];

      my.systemSetup = {
        components = {
          cognee = {
            name = "Cognee";
            description = "Locally supervised knowledge API, data stores, and MCP bridge.";
            managedBy = "hybrid";
          };

          ollama = {
            name = "Ollama";
            description = "Local embedding model runtime used by Cognee.";
            managedBy = "hybrid";
          };

          "agent-clients" = {
            name = "Agent clients";
            description = "Codex, Claude Code, Cursor, OMP, and Hermes memory consumers.";
            managedBy = "hybrid";
          };
        };

        integrations = {
          "cognee-server" = {
            name = "Cognee backend and generation path";
            description = "Prove Cognee data stores, embeddings, and Cognee-to-CLIProxyAPI generation.";
            requiredBy = [ "Shared knowledge service" ];
            dependsOn = [
              "tailscale-service-cognee"
              "cli-proxy-antigravity"
            ];
            connections = [
              {
                source = "cognee";
                target = "cli-proxy-api";
              }
              {
                source = "cognee";
                target = "ollama";
              }
            ];
            check = {
              kind = "http_json";
              url = "http://127.0.0.1:8088/health/detailed";
              expected = {
                status = "healthy";
                "components.relational_db.status" = "healthy";
                "components.vector_db.status" = "healthy";
                "components.graph_db.status" = "healthy";
                "components.file_storage.status" = "healthy";
                "components.llm_provider.status" = "healthy";
                "components.embedding_service.status" = "healthy";
              };
              success_detail = "Cognee stores, embeddings, and generation provider are healthy";
            };
            enrollment = {
              kind = "none";
              instructions = "Cognee is installed and supervised by Nix; rebuild and inspect cognee-status.";
            };
            statePaths = [
              "${home}/.local/share/cognee/data"
              "${home}/.local/share/cognee/system"
              "${home}/.local/state/cognee/secrets.env"
            ];
            secretPolicy = "Generated secrets remain mode 0600; databases and secrets require backup.";
            recovery = "Restore Cognee state and secrets together while its services are stopped.";
          };

          "cognee-agent-integrations" = {
            name = "Cognee agent connection";
            description = "Prove the shared agent API key and local MCP bridge can reach Cognee.";
            requiredBy = [ "Codex, Claude Code, Cursor, OMP, and Hermes memory" ];
            dependsOn = [ "cognee-server" ];
            connections = [
              {
                source = "agent-clients";
                target = "cognee";
              }
            ];
            check = {
              kind = "command";
              argv = [ "cognee-agent-status" ];
              success_detail = "Cognee agent API key and MCP bridge are ready";
            };
            enrollment = {
              kind = "command";
              instructions = "Provision or validate the shared Cognee key and supported agent clients.";
              argv = [ "cognee-agent-setup" ];
            };
            statePaths = [ "${home}/.local/state/cognee/agent-api-key" ];
            secretPolicy = "The generated API key stays outside Git and is backed up as protected state.";
            recovery = "Run cognee-agent-setup; rotate and revoke the old key if compromise is suspected.";
          };
        };
      };
    })

    (mkIf cogneeClient {
      my.systemSetup = {
        components = {
          cognee = {
            name = "Central Cognee service";
            description = "Knowledge service hosted by another tailnet machine.";
            managedBy = "external";
          };

          "agent-clients" = {
            name = "Local agent clients";
            description = "Local agents and their supervised remote Cognee MCP bridge.";
            managedBy = "hybrid";
          };
        };

        integrations."cognee-client" = {
          name = "Cognee remote client";
          description = "Prove the central service, per-machine key, and local MCP bridge work together.";
          requiredBy = [ "Remote agent memory" ];
          dependsOn = [ "tailscale-device" ];
          connections = [
            {
              source = "agent-clients";
              target = "cognee";
            }
          ];
          check = {
            kind = "command";
            argv = [ "cognee-client-status" ];
            success_detail = "Cognee client is enrolled and its MCP bridge is running";
          };
          enrollment = {
            kind = "command";
            instructions = "Create a distinct per-machine Cognee API key and configure local agents.";
            argv = [ "cognee-client-enroll" ];
          };
          statePaths = [ "${home}/.local/state/cognee/agent-api-key" ];
          secretPolicy = "The per-machine key stays mode 0600 and must not enter Git or agent config.";
          recovery = "Re-enroll with --replace and revoke the superseded key in Cognee.";
        };
      };
    })
  ];
}
