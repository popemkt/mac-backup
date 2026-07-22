{
  config,
  lib,
  pkgs,
  ...
}:

let
  aiCfg = config.my.stacks.ai-agents;
  cfg = aiCfg.cognee.server;
  inherit (config.my) username;

  home = "/Users/${username}";
  version = "1.4.0";
  mcpVersion = "0.5.4";
  apiPort = 8000;
  mcpPort = 8001;
  uiPort = 3000;
  gatewayPort = 8088;
  ollamaPort = 11435;

  stateRoot = "${home}/.local/state/cognee";
  secretFile = "${stateRoot}/secrets.env";
  integrationKeyFile = "${stateRoot}/agent-api-key";
  dataRoot = "${home}/.local/share/cognee/data";
  systemRoot = "${home}/.local/share/cognee/system";
  cacheRoot = "${home}/.cache/cognee";
  uiCache = "${home}/.cognee/ui-cache";
  pluginStateRoot = "${home}/.cognee-plugin";
  logRoot = "${home}/Library/Logs/cognee";
  python = "${home}/.local/share/uv/tools/cognee/bin/python";
  mcpExecutable = "${home}/.local/share/uv/tools/cognee/bin/cognee-mcp";
  publicUrl = "https://cognee.${config.my.stacks.vpn.tailnetDomain}";
  mcpUrl = "http://127.0.0.1:${toString mcpPort}/mcp";
  hermesHome = config.launchd.user.envVariables.HERMES_HOME or "${home}/.hermes";
  hermesConfig = "${hermesHome}/config.yaml";

  # Declarative uv tool installs owned by the Cognee service boundary.
  #
  # Audited by scripts/audit-system-discrepancies.sh (anchor: uvTools).
  # The Ollama extra supplies the Hugging Face tokenizer used for chunk sizing.
  uvTools = [
    "cognee[ollama]==${version}"
    "cognee-mcp==${mcpVersion}"
  ];

  environmentFile = pkgs.writeText "cognee.env" ''
    ENV=prod
    HOME=${home}
    DATA_ROOT_DIRECTORY=${dataRoot}
    SYSTEM_ROOT_DIRECTORY=${systemRoot}
    CACHE_ROOT_DIRECTORY=${cacheRoot}
    COGNEE_LOGS_DIR=${logRoot}
    COGNEE_LOG_SEARCH_HISTORY=false
    COGNEE_LOG_FILE=true
    TELEMETRY_DISABLED=1
    TOKENIZERS_PARALLELISM=false

    DB_PROVIDER=sqlite
    DB_NAME=cognee_db
    GRAPH_DATABASE_PROVIDER=ladybug
    GRAPH_DATASET_DATABASE_HANDLER=ladybug
    VECTOR_DB_PROVIDER=lancedb
    VECTOR_DATASET_DATABASE_HANDLER=lancedb

    LLM_PROVIDER=openai
    LLM_MODEL=openai/gemini-3.5-flash-low
    LLM_ENDPOINT=http://127.0.0.1:8317/v1
    LLM_API_KEY=local
    STRUCTURED_OUTPUT_FRAMEWORK=instructor
    LLM_INSTRUCTOR_MODE=json_mode

    EMBEDDING_PROVIDER=ollama
    EMBEDDING_MODEL=nomic-embed-text:latest
    EMBEDDING_DIMENSIONS=768
    EMBEDDING_ENDPOINT=http://127.0.0.1:${toString ollamaPort}/api/embed
    EMBEDDING_MAX_COMPLETION_TOKENS=2048
    HUGGINGFACE_TOKENIZER=nomic-ai/nomic-embed-text-v1.5

    ENABLE_BACKEND_ACCESS_CONTROL=true
    REQUIRE_AUTHENTICATION=true
    HASH_API_KEY=true
    # Cognee 1.4 materializes authenticated multipart uploads as temporary
    # local files before its loaders read them. Disabling local paths therefore
    # breaks both API and UI file uploads, even though the HTTP route accepts
    # UploadFile values rather than caller-supplied server paths.
    ACCEPT_LOCAL_FILE_PATH=true
    ALLOW_HTTP_REQUESTS=false
    DEFAULT_USER_EMAIL=cognee@example.com
    JWT_LIFETIME_SECONDS=86400
    UI_APP_URL=${publicUrl}
    CORS_ALLOWED_ORIGINS=${publicUrl},http://127.0.0.1:${toString gatewayPort}
  '';

  ensureState = pkgs.writeShellScript "ensure-cognee-state" ''
    set -euo pipefail

    ${pkgs.coreutils}/bin/install -d -m 0700 \
      "${stateRoot}" \
      "${dataRoot}" \
      "${systemRoot}"
    ${pkgs.coreutils}/bin/install -d -m 0750 \
      "${cacheRoot}" \
      "${cacheRoot}/caddy/config" \
      "${cacheRoot}/caddy/data" \
      "${cacheRoot}/npm" \
      "${cacheRoot}/ollama-home" \
      "${cacheRoot}/ollama-models" \
      "${uiCache}" \
      "${logRoot}"

    if [[ ! -e "${secretFile}" ]]; then
      secret_tmp="${secretFile}.tmp.$$"
      trap '${pkgs.coreutils}/bin/rm -f "$secret_tmp"' EXIT

      {
        printf 'FASTAPI_USERS_JWT_SECRET=%s\n' \
          "$(${pkgs.openssl}/bin/openssl rand -hex 32)"
        printf 'FASTAPI_USERS_VERIFICATION_TOKEN_SECRET=%s\n' \
          "$(${pkgs.openssl}/bin/openssl rand -hex 32)"
        printf 'FASTAPI_USERS_RESET_PASSWORD_TOKEN_SECRET=%s\n' \
          "$(${pkgs.openssl}/bin/openssl rand -hex 32)"
        printf 'DEFAULT_USER_PASSWORD=%s\n' \
          "$(${pkgs.openssl}/bin/openssl rand -hex 16)"
      } > "$secret_tmp"

      ${pkgs.coreutils}/bin/chmod 0600 "$secret_tmp"
      ${pkgs.coreutils}/bin/mv "$secret_tmp" "${secretFile}"
      trap - EXIT
    fi

    ${pkgs.coreutils}/bin/chmod 0600 "${secretFile}"
    for key in \
      FASTAPI_USERS_JWT_SECRET \
      FASTAPI_USERS_VERIFICATION_TOKEN_SECRET \
      FASTAPI_USERS_RESET_PASSWORD_TOKEN_SECRET \
      DEFAULT_USER_PASSWORD
    do
      if ! ${pkgs.gnugrep}/bin/grep -q "^$key=" "${secretFile}"; then
        printf 'error: %s is missing %s; refusing to replace existing secrets\n' \
          "${secretFile}" "$key" >&2
        exit 1
      fi
    done
  '';

  apiLauncher = pkgs.writeShellScript "cognee-api" ''
    set -euo pipefail

    if [[ ! -x "${python}" ]]; then
      printf 'error: Cognee ${version} is not installed yet; run rebuild\n' >&2
      exit 75
    fi

    set -a
    # shellcheck disable=SC1091
    source ${environmentFile}
    # shellcheck disable=SC1090
    source "${secretFile}"
    set +a

    cd "${systemRoot}"
    exec "${python}" -m uvicorn cognee.api.client:app \
      --host 127.0.0.1 \
      --port ${toString apiPort} \
      --proxy-headers \
      --forwarded-allow-ips=127.0.0.1
  '';

  mcpLauncher = pkgs.writeShellScript "cognee-mcp" ''
    set -euo pipefail

    if [[ ! -x "${mcpExecutable}" ]]; then
      printf 'error: Cognee MCP %s is not installed yet; run rebuild\n' \
        '${mcpVersion}' >&2
      exit 75
    fi
    if [[ ! -s "${integrationKeyFile}" ]]; then
      printf 'error: Cognee agent API key is missing; run cognee-agent-setup\n' >&2
      exit 75
    fi

    export HOME="${home}"
    export COGNEE_LOGS_DIR="${logRoot}"
    export COGNEE_LOG_FILE=true
    export TELEMETRY_DISABLED=1
    export COGNEE_SERVICE_URL="${publicUrl}"
    COGNEE_API_KEY="$(<"${integrationKeyFile}")"
    export COGNEE_API_KEY

    exec "${mcpExecutable}" \
      --transport http \
      --host 127.0.0.1 \
      --port ${toString mcpPort} \
      --path /mcp
  '';

  uiLauncher = pkgs.writeShellScript "cognee-ui" ''
    set -euo pipefail

    if [[ ! -x "${python}" ]]; then
      printf 'error: Cognee ${version} is not installed yet; run rebuild\n' >&2
      exit 75
    fi

    set -a
    # Keep Cognee imports used by the asset downloader on the service's normal
    # state and log paths instead of package-relative defaults.
    # shellcheck disable=SC1091
    source ${environmentFile}
    set +a

    export PATH="${pkgs.nodejs}/bin:/usr/bin:/bin"
    export npm_config_cache="${cacheRoot}/npm"
    export NEXT_PUBLIC_IS_CLOUD_ENVIRONMENT=false
    export NEXT_PUBLIC_LOCAL_API_URL="${publicUrl}"

    "${python}" -c \
      'from cognee.api.v1.ui.ui import download_frontend_assets; raise SystemExit(0 if download_frontend_assets() else 1)'

    frontend="${uiCache}/frontend"
    marker="$frontend/.cognee-production-build"
    expected="cognee=${version};api=${publicUrl}"

    # Cognee 1.4.0 ships an obsolete suppression: current locked typings make
    # the directive itself a build error. Remove only that release defect while
    # retaining the rest of Next.js's TypeScript checks.
    ${pkgs.gnused}/bin/sed -i \
      '/@ts-expect-error d3-force-3d has no types/d' \
      "$frontend/src/app/(graph)/GraphVisualization.tsx"

    if [[ ! -f "$marker" ]] || \
      ! ${pkgs.gnugrep}/bin/grep -Fqx "$expected" "$marker" || \
      [[ ! -d "$frontend/.next" ]]; then
      cd "$frontend"
      ${pkgs.nodejs}/bin/npm ci --no-audit --no-fund
      ${pkgs.nodejs}/bin/npm run build
      printf '%s\n' "$expected" > "$marker"
    fi

    cd "$frontend"
    exec ${pkgs.nodejs}/bin/npm run start -- \
      --hostname 127.0.0.1 \
      --port ${toString uiPort}
  '';

  caddyFile = pkgs.writeText "cognee.Caddyfile" ''
    {
      admin off
      auto_https off
    }

    http://:${toString gatewayPort} {
      bind 127.0.0.1

      @backend path /api/v1 /api/v1/* /health /health/* /docs /docs/* /redoc /redoc/* /openapi.json

      handle @backend {
        reverse_proxy 127.0.0.1:${toString apiPort} {
          # Tailscale terminates TLS before forwarding to this loopback HTTP
          # gateway. Preserve the public scheme so FastAPI redirects stay on
          # HTTPS instead of being blocked by browsers as mixed content.
          header_up X-Forwarded-Proto https
        }
      }

      handle {
        reverse_proxy 127.0.0.1:${toString uiPort}
      }
    }
  '';

  gatewayLauncher = pkgs.writeShellScript "cognee-gateway" ''
    set -euo pipefail
    export XDG_CONFIG_HOME="${cacheRoot}/caddy/config"
    export XDG_DATA_HOME="${cacheRoot}/caddy/data"
    exec ${pkgs.caddy}/bin/caddy run --config ${caddyFile} --adapter caddyfile
  '';

  ollamaLauncher = pkgs.writeShellScript "cognee-ollama" ''
    set -euo pipefail

    ollama=/opt/homebrew/bin/ollama
    if [[ ! -x "$ollama" ]]; then
      printf 'error: Ollama is not installed at %s\n' "$ollama" >&2
      exit 75
    fi

    export HOME="${cacheRoot}/ollama-home"
    export OLLAMA_MODELS="${cacheRoot}/ollama-models"
    export OLLAMA_HOST="127.0.0.1:${toString ollamaPort}"
    export OLLAMA_FLASH_ATTENTION=1
    export OLLAMA_KV_CACHE_TYPE=q8_0

    exec "$ollama" serve
  '';

  embeddingModelLauncher = pkgs.writeShellScript "cognee-embedding-model" ''
    set -euo pipefail

    ollama=/opt/homebrew/bin/ollama
    if [[ ! -x "$ollama" ]]; then
      printf 'error: Ollama is not installed at %s\n' "$ollama" >&2
      exit 75
    fi

    export HOME="${cacheRoot}/ollama-home"
    export OLLAMA_HOST="http://127.0.0.1:${toString ollamaPort}"

    if ! ${pkgs.curl}/bin/curl -fsS \
      http://127.0.0.1:${toString ollamaPort}/api/tags >/dev/null
    then
      printf 'error: Cognee Ollama is not ready\n' >&2
      exit 75
    fi

    if ! "$ollama" show nomic-embed-text:latest >/dev/null 2>&1; then
      exec "$ollama" pull nomic-embed-text:latest
    fi
  '';

  credentials = pkgs.writeShellScriptBin "cognee-credentials" ''
    set -euo pipefail

    if [[ ! -r "${secretFile}" ]]; then
      printf 'error: Cognee credentials do not exist yet; run rebuild\n' >&2
      exit 1
    fi

    set -a
    # shellcheck disable=SC1090
    source "${secretFile}"
    set +a

    printf 'URL:      %s\n' "${publicUrl}"
    printf 'Email:    %s\n' 'cognee@example.com'
    printf 'Password: %s\n' "$DEFAULT_USER_PASSWORD"
  '';

  status = pkgs.writeShellScriptBin "cognee-status" ''
    set -euo pipefail
    exec ${pkgs.curl}/bin/curl --fail --show-error \
      http://127.0.0.1:${toString gatewayPort}/health/detailed
  '';

  agentSetup = pkgs.writeShellScriptBin "cognee-agent-setup" ''
    set -euo pipefail
    umask 077

    local_api="http://127.0.0.1:${toString apiPort}"
    mcp_url="${mcpUrl}"
    key=""

    if ! ${pkgs.curl}/bin/curl -fsS --max-time 15 \
      "$local_api/health" >/dev/null
    then
      printf 'error: Cognee API is not ready; run cognee-status first\n' >&2
      exit 1
    fi

    if [[ -s "${integrationKeyFile}" ]]; then
      key="$(<"${integrationKeyFile}")"
      if ! ${pkgs.curl}/bin/curl -fsS --max-time 15 \
        -H "X-Api-Key: $key" \
        "$local_api/api/v1/users/me" >/dev/null
      then
        key=""
      fi
    fi

    if [[ -z "$key" ]]; then
      if [[ ! -r "${secretFile}" ]]; then
        printf 'error: Cognee credentials do not exist yet; run rebuild\n' >&2
        exit 1
      fi

      set -a
      # shellcheck disable=SC1091
      source "${secretFile}"
      set +a

      login_response="$(${pkgs.jq}/bin/jq -rn \
        --arg username 'cognee@example.com' \
        --arg password "$DEFAULT_USER_PASSWORD" \
        '"grant_type=password&username=\($username|@uri)&password=\($password|@uri)&scope="' \
        | ${pkgs.curl}/bin/curl -fsS --max-time 30 \
          -H 'Content-Type: application/x-www-form-urlencoded' \
          --data-binary @- \
          "$local_api/api/v1/auth/login")"
      unset \
        DEFAULT_USER_PASSWORD \
        FASTAPI_USERS_JWT_SECRET \
        FASTAPI_USERS_VERIFICATION_TOKEN_SECRET \
        FASTAPI_USERS_RESET_PASSWORD_TOKEN_SECRET
      token="$(${pkgs.jq}/bin/jq -er '.access_token' <<<"$login_response")"

      key_response="$(${pkgs.jq}/bin/jq -n \
        --arg name 'agent-integrations' '{name: $name}' \
        | ${pkgs.curl}/bin/curl -fsS --max-time 30 \
          -H 'Content-Type: application/json' \
          -H "Authorization: Bearer $token" \
          --data-binary @- \
          "$local_api/api/v1/auth/api-keys")"
      key="$(${pkgs.jq}/bin/jq -er '.key' <<<"$key_response")"

      key_tmp="$(${pkgs.coreutils}/bin/mktemp "${integrationKeyFile}.tmp.XXXXXX")"
      trap '${pkgs.coreutils}/bin/rm -f "$key_tmp"' EXIT
      printf '%s\n' "$key" > "$key_tmp"
      ${pkgs.coreutils}/bin/chmod 0600 "$key_tmp"
      ${pkgs.coreutils}/bin/mv "$key_tmp" "${integrationKeyFile}"
      trap - EXIT
    fi
    ${pkgs.coreutils}/bin/chmod 0600 "${integrationKeyFile}"

    ${pkgs.coreutils}/bin/install -d -m 0700 "${pluginStateRoot}"

    # Pin both lifecycle plugins to the self-hosted service even when their
    # parent GUI process predates launchctl's Cognee environment. Without an
    # explicit base_url, the upstream plugin falls back to localhost:8011 and
    # can replace the shared cached key with one for that private local server.
    for plugin_name in claude-code codex; do
      plugin_config="${pluginStateRoot}/$plugin_name/config.json"
      ${pkgs.coreutils}/bin/install -d -m 0700 \
        "$(${pkgs.coreutils}/bin/dirname "$plugin_config")"
      plugin_config_tmp="$(${pkgs.coreutils}/bin/mktemp \
        "$plugin_config.tmp.XXXXXX")"
      trap '${pkgs.coreutils}/bin/rm -f "$plugin_config_tmp"' EXIT
      if [[ -s "$plugin_config" ]]; then
        ${pkgs.jq}/bin/jq \
          --arg base_url "${publicUrl}" \
          --arg dataset 'main_dataset' \
          '.base_url = $base_url | .dataset = $dataset' \
          "$plugin_config" > "$plugin_config_tmp"
      else
        ${pkgs.jq}/bin/jq -n \
          --arg base_url "${publicUrl}" \
          --arg dataset 'main_dataset' \
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
      --arg base_url "${publicUrl}" \
      --arg updated_at "$(${pkgs.coreutils}/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{base_url: $base_url, api_key: ., updated_at: $updated_at}' \
      > "$plugin_key_tmp"
    ${pkgs.coreutils}/bin/chmod 0600 "$plugin_key_tmp"
    ${pkgs.coreutils}/bin/mv "$plugin_key_tmp" \
      "${pluginStateRoot}/api_key.json"
    trap - EXIT

    cursor_config="${home}/.cursor/mcp.json"
    ${pkgs.coreutils}/bin/install -d -m 0700 "$(${pkgs.coreutils}/bin/dirname "$cursor_config")"
    cursor_tmp="$(${pkgs.coreutils}/bin/mktemp "$cursor_config.tmp.XXXXXX")"
    trap '${pkgs.coreutils}/bin/rm -f "$cursor_tmp"' EXIT
    if [[ -s "$cursor_config" ]]; then
      ${pkgs.jq}/bin/jq --arg url "$mcp_url" \
        '.mcpServers = (.mcpServers // {}) | .mcpServers.cognee = {url: $url}' \
        "$cursor_config" > "$cursor_tmp"
    else
      ${pkgs.jq}/bin/jq -n --arg url "$mcp_url" \
        '{mcpServers: {cognee: {url: $url}}}' > "$cursor_tmp"
    fi
    ${pkgs.coreutils}/bin/chmod 0600 "$cursor_tmp"
    ${pkgs.coreutils}/bin/mv "$cursor_tmp" "$cursor_config"
    trap - EXIT

    omp_config="${home}/.omp/agent/mcp.json"
    ${pkgs.coreutils}/bin/install -d -m 0700 "$(${pkgs.coreutils}/bin/dirname "$omp_config")"
    omp_tmp="$(${pkgs.coreutils}/bin/mktemp "$omp_config.tmp.XXXXXX")"
    trap '${pkgs.coreutils}/bin/rm -f "$omp_tmp"' EXIT
    if [[ -s "$omp_config" ]]; then
      ${pkgs.jq}/bin/jq --arg url "$mcp_url" \
        '.mcpServers = (.mcpServers // {}) | .mcpServers.cognee = {type: "http", url: $url}' \
        "$omp_config" > "$omp_tmp"
    else
      ${pkgs.jq}/bin/jq -n --arg url "$mcp_url" \
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
    COGNEE_MCP_URL="$mcp_url" ${pkgs.yq-go}/bin/yq -i \
      '.mcp_servers.cognee = {"url": strenv(COGNEE_MCP_URL)}' \
      "${hermesConfig}"
    ${pkgs.coreutils}/bin/chmod 0600 "${hermesConfig}"

    /bin/launchctl kickstart -k \
      "gui/$(${pkgs.coreutils}/bin/id -u)/org.nixos.cognee-mcp" \
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

    printf 'Cognee agent integrations configured. Restart active agent sessions.\n'
    printf 'Shared MCP endpoint: %s\n' "$mcp_url"
    printf 'Shared dataset: main_dataset\n'
  '';
in
lib.mkIf (aiCfg.enable && cfg.enable) {
  assertions = [
    {
      assertion = aiCfg.ollama;
      message = "The Cognee service requires my.stacks.ai-agents.ollama = true.";
    }
    {
      assertion = config.my.stacks.vpn.enable;
      message = "The Cognee server requires my.stacks.vpn.enable = true.";
    }
    {
      assertion = builtins.match "https://[^/]+.*" publicUrl != null;
      message = "Cognee publicUrl must be an HTTPS URL.";
    }
  ];

  home-manager.users.${username} =
    { lib, ... }:
    {
      home.packages = [
        agentSetup
        credentials
        status
      ];

      home.sessionVariables = {
        COGNEE_BASE_URL = publicUrl;
        COGNEE_PLUGIN_DATASET = "main_dataset";
      };

      home.activation.ensureCogneeState = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        $DRY_RUN_CMD ${ensureState}
      '';

      home.activation.installCogneeUvTool = lib.hm.dag.entryAfter [ "ensureCogneeState" ] ''
        export SDKROOT="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
        export CC=/usr/bin/clang
        export CXX=/usr/bin/clang++
        export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=/usr/bin/clang

        receipt="${home}/.local/share/uv/tools/cognee/uv-receipt.toml"
        if ! ${pkgs.uv}/bin/uv tool list 2>/dev/null \
            | ${pkgs.gnugrep}/bin/grep -q '^cognee v1\.4\.0$' \
          || [[ ! -x "${python}" ]] \
          || [[ "$("${python}" -c 'import platform; print(platform.python_version())' 2>/dev/null || true)" != "${pkgs.python313.version}" ]] \
          || [[ ! -f "$receipt" ]] \
          || ! ${pkgs.gnugrep}/bin/grep -q '"ollama"' "$receipt" \
          || ! ${pkgs.gnugrep}/bin/grep -q 'cognee-mcp' "$receipt" \
          || ! ${pkgs.gnugrep}/bin/grep -q '0\.5\.4' "$receipt"
        then
          $DRY_RUN_CMD ${pkgs.uv}/bin/uv tool install \
            --force \
            --python ${pkgs.python313}/bin/python3 \
            --with ${lib.escapeShellArg (builtins.elemAt uvTools 1)} \
            ${lib.escapeShellArg (builtins.head uvTools)}
        fi
      '';
    };

  launchd.user.envVariables = {
    COGNEE_BASE_URL = publicUrl;
    COGNEE_PLUGIN_DATASET = "main_dataset";
  };

  launchd.user.agents = {
    cognee-api.serviceConfig = {
      ProgramArguments = [ "${apiLauncher}" ];
      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 30;
      WorkingDirectory = systemRoot;
      StandardOutPath = "${logRoot}/api.out.log";
      StandardErrorPath = "${logRoot}/api.err.log";
      EnvironmentVariables.HOME = home;
    };

    cognee-ui.serviceConfig = {
      ProgramArguments = [ "${uiLauncher}" ];
      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 30;
      WorkingDirectory = home;
      StandardOutPath = "${logRoot}/ui.out.log";
      StandardErrorPath = "${logRoot}/ui.err.log";
      EnvironmentVariables.HOME = home;
    };

    cognee-mcp.serviceConfig = {
      ProgramArguments = [ "${mcpLauncher}" ];
      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 30;
      WorkingDirectory = home;
      StandardOutPath = "${logRoot}/mcp.out.log";
      StandardErrorPath = "${logRoot}/mcp.err.log";
      EnvironmentVariables.HOME = home;
    };

    cognee-gateway.serviceConfig = {
      ProgramArguments = [ "${gatewayLauncher}" ];
      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 30;
      WorkingDirectory = home;
      StandardOutPath = "${logRoot}/gateway.out.log";
      StandardErrorPath = "${logRoot}/gateway.err.log";
      EnvironmentVariables.HOME = home;
    };

    cognee-ollama.serviceConfig = {
      ProgramArguments = [ "${ollamaLauncher}" ];
      RunAtLoad = true;
      KeepAlive = true;
      ThrottleInterval = 30;
      WorkingDirectory = home;
      StandardOutPath = "${logRoot}/ollama.out.log";
      StandardErrorPath = "${logRoot}/ollama.err.log";
      EnvironmentVariables.HOME = home;
    };

    cognee-embedding-model.serviceConfig = {
      ProgramArguments = [ "${embeddingModelLauncher}" ];
      RunAtLoad = true;
      KeepAlive.SuccessfulExit = false;
      ThrottleInterval = 30;
      WorkingDirectory = home;
      StandardOutPath = "${logRoot}/embedding-model.out.log";
      StandardErrorPath = "${logRoot}/embedding-model.err.log";
      EnvironmentVariables.HOME = home;
    };
  };
}
