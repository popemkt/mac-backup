{
  config,
  lib,
  pkgs,
  ...
}:

let
  aiCfg = config.my.stacks.ai-agents;
  serverCfg = aiCfg.cognee;
  cfg = serverCfg.client;
  inherit (config.my) hostname username;

  home = "/Users/${username}";
  mcpVersion = "0.5.4";
  mcpPort = 8001;
  serviceUrl = lib.removeSuffix "/" cfg.serviceUrl;
  inherit (cfg) dataset;

  # Declarative uv tool install owned by the remote client boundary.
  # Audited by scripts/audit-system-discrepancies.sh (anchor: uvTools).
  uvTools = [ "cognee-mcp==${mcpVersion}" ];

  stateRoot = "${home}/.local/state/cognee";
  keyFile = "${stateRoot}/agent-api-key";
  pluginStateRoot = "${home}/.cognee-plugin";
  logRoot = "${home}/Library/Logs/cognee";
  mcpExecutable = "${home}/.local/share/uv/tools/cognee-mcp/bin/cognee-mcp";
  mcpUrl = "http://127.0.0.1:${toString mcpPort}/mcp";
  hermesHome = config.launchd.user.envVariables.HERMES_HOME or "${home}/.hermes";
  hermesConfig = "${hermesHome}/config.yaml";

  ensureState = pkgs.writeShellScript "ensure-cognee-client-state" ''
    set -euo pipefail
    ${pkgs.coreutils}/bin/install -d -m 0700 \
      "${stateRoot}" \
      "${pluginStateRoot}"
    ${pkgs.coreutils}/bin/install -d -m 0750 "${logRoot}"
    if [[ -e "${keyFile}" ]]; then
      ${pkgs.coreutils}/bin/chmod 0600 "${keyFile}"
    fi
  '';

  mcpLauncher = pkgs.writeShellScript "cognee-mcp-client" ''
    set -euo pipefail

    if [[ ! -x "${mcpExecutable}" ]]; then
      printf 'error: Cognee MCP %s is not installed yet; run rebuild\n' \
        '${mcpVersion}' >&2
      exit 75
    fi
    if [[ ! -s "${keyFile}" ]]; then
      printf 'error: Cognee client key is missing; run cognee-client-enroll\n' >&2
      exit 75
    fi

    export HOME="${home}"
    export COGNEE_LOGS_DIR="${logRoot}"
    export COGNEE_LOG_FILE=true
    export TELEMETRY_DISABLED=1
    export COGNEE_SERVICE_URL="${serviceUrl}"
    COGNEE_API_KEY="$(<"${keyFile}")"
    export COGNEE_API_KEY

    exec "${mcpExecutable}" \
      --transport http \
      --host 127.0.0.1 \
      --port ${toString mcpPort} \
      --path /mcp
  '';

  agentSetup = pkgs.writeShellScriptBin "cognee-client-setup" ''
    set -euo pipefail
    umask 077

    if [[ ! -s "${keyFile}" ]]; then
      printf 'error: no Cognee API key; run cognee-client-enroll first\n' >&2
      exit 1
    fi

    key="$(<"${keyFile}")"
    if ! ${pkgs.curl}/bin/curl -fsS --max-time 20 \
      -H "X-Api-Key: $key" \
      "${serviceUrl}/api/v1/users/me" >/dev/null
    then
      printf 'error: the Cognee key is invalid or the home service is unreachable\n' >&2
      exit 1
    fi
    ${pkgs.coreutils}/bin/chmod 0600 "${keyFile}"

    ${pkgs.coreutils}/bin/install -d -m 0700 "${pluginStateRoot}"
    for plugin_name in claude-code codex; do
      plugin_config="${pluginStateRoot}/$plugin_name/config.json"
      ${pkgs.coreutils}/bin/install -d -m 0700 \
        "$(${pkgs.coreutils}/bin/dirname "$plugin_config")"
      plugin_config_tmp="$(${pkgs.coreutils}/bin/mktemp \
        "$plugin_config.tmp.XXXXXX")"
      trap '${pkgs.coreutils}/bin/rm -f "$plugin_config_tmp"' EXIT
      if [[ -s "$plugin_config" ]]; then
        ${pkgs.jq}/bin/jq \
          --arg base_url "${serviceUrl}" \
          --arg dataset "${dataset}" \
          '.base_url = $base_url | .dataset = $dataset' \
          "$plugin_config" > "$plugin_config_tmp"
      else
        ${pkgs.jq}/bin/jq -n \
          --arg base_url "${serviceUrl}" \
          --arg dataset "${dataset}" \
          '{base_url: $base_url, dataset: $dataset}' \
          > "$plugin_config_tmp"
      fi
      ${pkgs.coreutils}/bin/chmod 0600 "$plugin_config_tmp"
      ${pkgs.coreutils}/bin/mv "$plugin_config_tmp" "$plugin_config"
      trap - EXIT
    done

    plugin_key_tmp="$(${pkgs.coreutils}/bin/mktemp \
      "${pluginStateRoot}/api_key.json.tmp.XXXXXX")"
    trap '${pkgs.coreutils}/bin/rm -f "$plugin_key_tmp"' EXIT
    printf '%s' "$key" | ${pkgs.jq}/bin/jq -Rs \
      --arg base_url "${serviceUrl}" \
      --arg updated_at "$(${pkgs.coreutils}/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{base_url: $base_url, api_key: ., updated_at: $updated_at}' \
      > "$plugin_key_tmp"
    ${pkgs.coreutils}/bin/chmod 0600 "$plugin_key_tmp"
    ${pkgs.coreutils}/bin/mv "$plugin_key_tmp" \
      "${pluginStateRoot}/api_key.json"
    trap - EXIT

    cursor_config="${home}/.cursor/mcp.json"
    ${pkgs.coreutils}/bin/install -d -m 0700 \
      "$(${pkgs.coreutils}/bin/dirname "$cursor_config")"
    cursor_tmp="$(${pkgs.coreutils}/bin/mktemp "$cursor_config.tmp.XXXXXX")"
    trap '${pkgs.coreutils}/bin/rm -f "$cursor_tmp"' EXIT
    if [[ -s "$cursor_config" ]]; then
      ${pkgs.jq}/bin/jq --arg url "${mcpUrl}" \
        '.mcpServers = (.mcpServers // {}) | .mcpServers.cognee = {url: $url}' \
        "$cursor_config" > "$cursor_tmp"
    else
      ${pkgs.jq}/bin/jq -n --arg url "${mcpUrl}" \
        '{mcpServers: {cognee: {url: $url}}}' > "$cursor_tmp"
    fi
    ${pkgs.coreutils}/bin/chmod 0600 "$cursor_tmp"
    ${pkgs.coreutils}/bin/mv "$cursor_tmp" "$cursor_config"
    trap - EXIT

    omp_config="${home}/.omp/agent/mcp.json"
    ${pkgs.coreutils}/bin/install -d -m 0700 \
      "$(${pkgs.coreutils}/bin/dirname "$omp_config")"
    omp_tmp="$(${pkgs.coreutils}/bin/mktemp "$omp_config.tmp.XXXXXX")"
    trap '${pkgs.coreutils}/bin/rm -f "$omp_tmp"' EXIT
    if [[ -s "$omp_config" ]]; then
      ${pkgs.jq}/bin/jq --arg url "${mcpUrl}" \
        '.mcpServers = (.mcpServers // {}) | .mcpServers.cognee = {type: "http", url: $url}' \
        "$omp_config" > "$omp_tmp"
    else
      ${pkgs.jq}/bin/jq -n --arg url "${mcpUrl}" \
        '{mcpServers: {cognee: {type: "http", url: $url}}}' > "$omp_tmp"
    fi
    ${pkgs.coreutils}/bin/chmod 0600 "$omp_tmp"
    ${pkgs.coreutils}/bin/mv "$omp_tmp" "$omp_config"
    trap - EXIT

    ${pkgs.coreutils}/bin/install -d -m 0700 \
      "$(${pkgs.coreutils}/bin/dirname "${hermesConfig}")"
    if [[ ! -e "${hermesConfig}" ]]; then
      ${pkgs.coreutils}/bin/install -m 0600 /dev/null "${hermesConfig}"
    fi
    COGNEE_MCP_URL="${mcpUrl}" ${pkgs.yq-go}/bin/yq -i \
      '.mcp_servers.cognee = {"url": strenv(COGNEE_MCP_URL)}' \
      "${hermesConfig}"
    ${pkgs.coreutils}/bin/chmod 0600 "${hermesConfig}"

    /bin/launchctl kickstart -k \
      "gui/$(${pkgs.coreutils}/bin/id -u)/org.nixos.cognee-mcp-client" \
      >/dev/null 2>&1 || true

    if command -v codex >/dev/null 2>&1; then
      CODEX_HOME="${home}/.codex" codex features enable hooks
      if ! CODEX_HOME="${home}/.codex" codex plugin marketplace list 2>/dev/null \
        | ${pkgs.gnugrep}/bin/grep -q '^cognee[[:space:]]'
      then
        CODEX_HOME="${home}/.codex" \
          codex plugin marketplace add topoteretes/cognee-integrations --ref main
      fi
      if ! CODEX_HOME="${home}/.codex" codex plugin list 2>/dev/null \
        | ${pkgs.gnugrep}/bin/grep -q '^cognee@cognee[[:space:]]\+installed,'
      then
        CODEX_HOME="${home}/.codex" codex plugin add cognee@cognee
      fi
    else
      printf 'warning: codex is unavailable; skipped its Cognee plugin\n' >&2
    fi

    if command -v claude >/dev/null 2>&1; then
      if ! claude plugin marketplace list 2>/dev/null \
        | ${pkgs.gnugrep}/bin/grep -q 'cognee$'
      then
        claude plugin marketplace add topoteretes/cognee-integrations
      fi
      if ! claude plugin list 2>/dev/null \
        | ${pkgs.gnugrep}/bin/grep -q 'cognee-memory@cognee'
      then
        claude plugin install cognee-memory@cognee
      fi
    else
      printf 'warning: claude is unavailable; skipped its Cognee plugin\n' >&2
    fi

    printf 'Cognee client configured for %s. Restart active agent sessions.\n' \
      '${serviceUrl}'
    printf 'Local MCP endpoint: %s\n' '${mcpUrl}'
    printf 'Lifecycle dataset: %s\n' '${dataset}'
  '';

  enroll = pkgs.writeShellScriptBin "cognee-client-enroll" ''
    set -euo pipefail
    umask 077

    replace=false
    if [[ "''${1:-}" == "--replace" ]]; then
      replace=true
    elif [[ $# -ne 0 ]]; then
      printf 'usage: cognee-client-enroll [--replace]\n' >&2
      exit 2
    fi

    if [[ -s "${keyFile}" ]] && [[ "$replace" != true ]]; then
      printf 'A client key already exists. Run cognee-client-setup, or use --replace to rotate it.\n' >&2
      exit 1
    fi
    if [[ ! -t 0 ]]; then
      printf 'error: enrollment is interactive and must run in a terminal\n' >&2
      exit 1
    fi

    printf 'Cognee account email for %s: ' '${hostname}'
    IFS= read -r email
    printf 'Cognee account password: '
    IFS= read -rs password
    printf '\n'
    if [[ -z "$email" ]] || [[ -z "$password" ]]; then
      printf 'error: email and password are required\n' >&2
      exit 1
    fi

    response="$(${pkgs.coreutils}/bin/mktemp)"
    trap '${pkgs.coreutils}/bin/rm -f "$response"' EXIT
    register_status="$(${pkgs.jq}/bin/jq -n \
      --arg email "$email" --arg password "$password" \
      '{email: $email, password: $password}' \
      | ${pkgs.curl}/bin/curl -sS --max-time 30 \
        -o "$response" -w '%{http_code}' \
        -H 'Content-Type: application/json' \
        --data-binary @- \
        "${serviceUrl}/api/v1/auth/register")"
    if [[ "$register_status" != 201 ]] && [[ "$register_status" != 400 ]]; then
      printf 'error: Cognee registration failed (HTTP %s): ' "$register_status" >&2
      ${pkgs.jq}/bin/jq -cr '.detail // .' "$response" >&2 || true
      exit 1
    fi

    login_response="$(${pkgs.jq}/bin/jq -rn \
      --arg username "$email" --arg password "$password" \
      '"grant_type=password&username=\($username|@uri)&password=\($password|@uri)&scope="' \
      | ${pkgs.curl}/bin/curl -fsS --max-time 30 \
        -H 'Content-Type: application/x-www-form-urlencoded' \
        --data-binary @- \
        "${serviceUrl}/api/v1/auth/login")"
    unset password
    token="$(${pkgs.jq}/bin/jq -er '.access_token' <<<"$login_response")"

    key_response="$(${pkgs.jq}/bin/jq -n \
      --arg name 'agent-${hostname}' '{name: $name}' \
      | ${pkgs.curl}/bin/curl -fsS --max-time 30 \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $token" \
        --data-binary @- \
        "${serviceUrl}/api/v1/auth/api-keys")"
    unset token
    key="$(${pkgs.jq}/bin/jq -er '.key' <<<"$key_response")"

    ${pkgs.coreutils}/bin/install -d -m 0700 "${stateRoot}"
    key_tmp="$(${pkgs.coreutils}/bin/mktemp "${keyFile}.tmp.XXXXXX")"
    trap '${pkgs.coreutils}/bin/rm -f "$response" "$key_tmp"' EXIT
    printf '%s\n' "$key" > "$key_tmp"
    ${pkgs.coreutils}/bin/chmod 0600 "$key_tmp"
    ${pkgs.coreutils}/bin/mv "$key_tmp" "${keyFile}"
    trap - EXIT
    ${pkgs.coreutils}/bin/rm -f "$response"

    exec ${agentSetup}/bin/cognee-client-setup
  '';

  status = pkgs.writeShellScriptBin "cognee-client-status" ''
    set -euo pipefail

    ${pkgs.curl}/bin/curl -fsS --max-time 20 \
      "${serviceUrl}/health/detailed" >/dev/null
    printf 'Central Cognee service: healthy\n'

    if [[ ! -s "${keyFile}" ]]; then
      printf 'Client API key: missing (run cognee-client-enroll)\n' >&2
      exit 1
    fi
    key="$(<"${keyFile}")"
    ${pkgs.curl}/bin/curl -fsS --max-time 20 \
      -H "X-Api-Key: $key" \
      "${serviceUrl}/api/v1/users/me" >/dev/null
    printf 'Client API key: valid\n'

    if /bin/launchctl print \
      "gui/$(${pkgs.coreutils}/bin/id -u)/org.nixos.cognee-mcp-client" \
      2>/dev/null | ${pkgs.gnugrep}/bin/grep -q 'state = running'
    then
      printf 'Local MCP bridge: running\n'
    else
      printf 'Local MCP bridge: not ready; run cognee-client-setup\n' >&2
      exit 1
    fi
  '';
in
lib.mkIf (aiCfg.enable && cfg.enable) {
  assertions = [
    {
      assertion = !serverCfg.enable;
      message = "Cognee server and remote client roles cannot both be enabled on one host.";
    }
    {
      assertion = builtins.match "https://[^/]+.*" serviceUrl != null;
      message = "Cognee client serviceUrl must be an HTTPS URL.";
    }
    {
      assertion = dataset != "";
      message = "Cognee client dataset cannot be empty.";
    }
  ];

  home-manager.users.${username} =
    { lib, ... }:
    {
      home.packages = [
        agentSetup
        enroll
        status
      ];

      home.sessionVariables = {
        COGNEE_BASE_URL = serviceUrl;
        COGNEE_PLUGIN_DATASET = dataset;
      };

      home.activation.ensureCogneeClientState = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        $DRY_RUN_CMD ${ensureState}
      '';

      home.activation.installCogneeMcpUvTool = lib.hm.dag.entryAfter [ "ensureCogneeClientState" ] ''
        export SDKROOT="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"

        receipt="${home}/.local/share/uv/tools/cognee-mcp/uv-receipt.toml"
        if [[ ! -x "${mcpExecutable}" ]] \
          || [[ ! -f "$receipt" ]] \
          || ! ${pkgs.uv}/bin/uv tool list 2>/dev/null \
            | ${pkgs.gnugrep}/bin/grep -q '^cognee-mcp v0\.5\.4$'
        then
          $DRY_RUN_CMD ${pkgs.uv}/bin/uv tool install \
            --force \
            --python ${pkgs.python3}/bin/python3 \
            ${lib.escapeShellArg (builtins.head uvTools)}
        fi
      '';
    };

  launchd.user.envVariables = {
    COGNEE_BASE_URL = serviceUrl;
    COGNEE_PLUGIN_DATASET = dataset;
  };

  launchd.user.agents.cognee-mcp-client.serviceConfig = {
    ProgramArguments = [ "${mcpLauncher}" ];
    RunAtLoad = true;
    KeepAlive = true;
    ThrottleInterval = 30;
    WorkingDirectory = home;
    StandardOutPath = "${logRoot}/mcp-client.out.log";
    StandardErrorPath = "${logRoot}/mcp-client.err.log";
    EnvironmentVariables.HOME = home;
  };
}
