{
  config,
  pkgs,
  lib,
  ...
}:

let
  inherit (config.my) username;
  home = "/Users/${username}";
  port = 8317;
  configPath = "${home}/.config/cli-proxy-api/config.yaml";
  stateRoot = "${home}/.local/state/cli-proxy-api";
  secretFile = "${stateRoot}/secrets.env";
  authDir = "${home}/.local/share/cli-proxy-api";
  # Legacy ad-hoc key file the user created while wiring DeepSeek.
  legacyDotenv = "${home}/.dotfiles/.env";

  # Intentional provider shape only. Upstream API keys are injected at
  # activation from ${secretFile} so they never enter the Nix store or Git.
  baseConfig = {
    host = "127.0.0.1";
    inherit port;

    tls.enable = false;

    remote-management = {
      allow-remote = false;
      secret-key = "";
      disable-control-panel = true;
    };

    auth-dir = authDir;
    # Deliberately trust local clients. The service is loopback-only and this
    # machine is operated as a single-user workstation.
    api-keys = [ ];

    debug = false;
    logging-to-file = false;
    usage-statistics-enabled = false;

    openai-compatibility = [
      {
        name = "deepseek";
        base-url = "https://api.deepseek.com";
        models = [
          {
            name = "deepseek-v4-flash";
            alias = "deepseek-v4-flash";
          }
          {
            name = "deepseek-v4-pro";
            alias = "deepseek-v4-pro";
          }
        ];
      }
    ];
  };

  baseConfigFile = (pkgs.formats.yaml { }).generate "cli-proxy-api.base.yaml" baseConfig;

  renderConfig = pkgs.writeShellScript "render-cli-proxy-api-config" ''
    set -euo pipefail

    ${pkgs.coreutils}/bin/install -d -m 0700 \
      ${lib.escapeShellArg stateRoot} \
      ${lib.escapeShellArg authDir} \
      ${lib.escapeShellArg "${home}/.config/cli-proxy-api"}

    secret_file=${lib.escapeShellArg secretFile}
    legacy_dotenv=${lib.escapeShellArg legacyDotenv}
    config_path=${lib.escapeShellArg configPath}
    base_config=${lib.escapeShellArg baseConfigFile}

    if [[ ! -e "$secret_file" ]]; then
      secret_tmp="$secret_file.tmp.$$"
      {
        printf '# CLIProxyAPI upstream provider secrets. Mode 0600; do not commit.\n'
        printf '# DEEPSEEK_API_KEY=\n'
      } > "$secret_tmp"
      ${pkgs.coreutils}/bin/chmod 0600 "$secret_tmp"
      ${pkgs.coreutils}/bin/mv "$secret_tmp" "$secret_file"
    fi
    ${pkgs.coreutils}/bin/chmod 0600 "$secret_file"

    # One-time migration from the ad-hoc repo .env KEY= the user added.
    if ! ${pkgs.gnugrep}/bin/grep -q '^DEEPSEEK_API_KEY=' "$secret_file" \
      && [[ -r "$legacy_dotenv" ]] \
      && ${pkgs.gnugrep}/bin/grep -q '^KEY=' "$legacy_dotenv"; then
      key="$(${pkgs.gnused}/bin/sed -n 's/^KEY=//p' "$legacy_dotenv" | ${pkgs.coreutils}/bin/head -n 1)"
      if [[ -n "$key" ]]; then
        printf 'DEEPSEEK_API_KEY=%s\n' "$key" >> "$secret_file"
        ${pkgs.coreutils}/bin/chmod 0600 "$secret_file"
      fi
    fi

    set -a
    # shellcheck disable=SC1090
    source "$secret_file"
    set +a

    config_tmp="$config_path.tmp.$$"
    ${pkgs.coreutils}/bin/cp "$base_config" "$config_tmp"
    ${pkgs.coreutils}/bin/chmod 0600 "$config_tmp"

    if [[ -n "''${DEEPSEEK_API_KEY:-}" ]]; then
      DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" ${pkgs.yq-go}/bin/yq -i '
        (.["openai-compatibility"][] | select(.name == "deepseek"))
          |= . + {"api-key-entries": [{"api-key": strenv(DEEPSEEK_API_KEY)}]}
      ' "$config_tmp"
    else
      printf 'warning: %s has no DEEPSEEK_API_KEY; DeepSeek upstream will be unauthenticated\n' \
        "$secret_file" >&2
    fi

    ${pkgs.coreutils}/bin/mv "$config_tmp" "$config_path"
    ${pkgs.coreutils}/bin/chmod 0600 "$config_path"
  '';
in
lib.mkIf config.my.stacks.ai-agents.enable {
  home-manager.users.${username} =
    { lib, ... }:
    {
      home.packages = [ pkgs.cli-proxy-api ];
      home.activation.renderCliProxyApiConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        $DRY_RUN_CMD ${renderConfig}
      '';
    };

  # CLIProxyAPI exposes OAuth-backed and OpenAI-compatible providers through a
  # local API. Keep the generic OpenAI/Anthropic base URL variables unset
  # globally so clients opt in explicitly and continue working when this
  # service is unavailable.
  launchd.user.agents.cli-proxy-api = {
    serviceConfig = {
      ProgramArguments = [
        "${pkgs.cli-proxy-api}/bin/cli-proxy-api"
        "-config"
        configPath
      ];
      RunAtLoad = true;
      KeepAlive.SuccessfulExit = false;
      ThrottleInterval = 30;
      WorkingDirectory = home;
      StandardOutPath = "${home}/Library/Logs/cli-proxy-api.out.log";
      StandardErrorPath = "${home}/Library/Logs/cli-proxy-api.err.log";
      EnvironmentVariables.HOME = home;
    };
  };
}
