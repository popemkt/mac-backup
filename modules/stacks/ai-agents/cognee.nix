{
  config,
  lib,
  pkgs,
  ...
}:

let
  aiCfg = config.my.stacks.ai-agents;
  cfg = aiCfg.cognee;
  inherit (config.my) username;

  home = "/Users/${username}";
  version = "1.4.0";
  apiPort = 8000;
  uiPort = 3000;
  gatewayPort = 8088;
  ollamaPort = 11435;

  stateRoot = "${home}/.local/state/cognee";
  secretFile = "${stateRoot}/secrets.env";
  dataRoot = "${home}/.local/share/cognee/data";
  systemRoot = "${home}/.local/share/cognee/system";
  cacheRoot = "${home}/.cache/cognee";
  uiCache = "${home}/.cognee/ui-cache";
  logRoot = "${home}/Library/Logs/cognee";
  python = "${home}/.local/share/uv/tools/cognee/bin/python";
  publicUrl = lib.removeSuffix "/" cfg.publicUrl;

  # Declarative uv tool installs owned by the Cognee service boundary.
  #
  # Audited by scripts/audit-system-discrepancies.sh (anchor: uvTools).
  # The Ollama extra supplies the Hugging Face tokenizer used for chunk sizing.
  uvTools = [
    "cognee[ollama]==${version}"
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
    ACCEPT_LOCAL_FILE_PATH=false
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

    http://127.0.0.1:${toString gatewayPort} {
      bind 127.0.0.1

      @backend path /api/v1 /api/v1/* /health /health/* /docs /docs/* /redoc /redoc/* /openapi.json

      handle @backend {
        reverse_proxy 127.0.0.1:${toString apiPort}
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
in
lib.mkIf (aiCfg.enable && cfg.enable) {
  assertions = [
    {
      assertion = aiCfg.ollama;
      message = "The Cognee service requires my.stacks.ai-agents.ollama = true.";
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
        credentials
        status
      ];

      home.activation.ensureCogneeState = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        $DRY_RUN_CMD ${ensureState}
      '';

      home.activation.installCogneeUvTool = lib.hm.dag.entryAfter [ "ensureCogneeState" ] ''
        export SDKROOT="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"

        receipt="${home}/.local/share/uv/tools/cognee/uv-receipt.toml"
        if ! ${pkgs.uv}/bin/uv tool list 2>/dev/null \
            | ${pkgs.gnugrep}/bin/grep -q '^cognee v1\.4\.0$' \
          || [[ ! -f "$receipt" ]] \
          || ! ${pkgs.gnugrep}/bin/grep -q '"ollama"' "$receipt"
        then
          $DRY_RUN_CMD ${pkgs.uv}/bin/uv tool install \
            --force \
            --python ${pkgs.python3}/bin/python3 \
            ${lib.escapeShellArg (builtins.head uvTools)}
        fi
      '';
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
