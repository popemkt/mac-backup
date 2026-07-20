# Cognee Service

Cognee 1.4.0 runs as an authenticated private service on the personal Mac.
The machine configuration owns the deployed version, process supervision,
loopback routing, local model dependencies, and Tailscale exposure. Cognee's
databases and credentials remain mutable state and must be backed up separately.

## Endpoints

The external origin is:

```text
https://cognee.taild98079.ts.net
```

One loopback gateway at `127.0.0.1:8088` keeps the browser and API on the same
origin:

| Paths | Local target |
|---|---|
| `/` | production Next.js UI on `127.0.0.1:3000` |
| `/api/v1/*`, `/health*`, `/docs*`, `/openapi.json` | Cognee API on `127.0.0.1:8000` |

Tailscale publishes the gateway as the `svc:cognee` Service identity. The API,
UI, CLIProxyAPI, and Ollama do not bind to the LAN.

## First Start

Apply the machine configuration:

```bash
rebuild
```

The first activation installs `cognee[ollama]==1.4.0` as a uv tool and
generates credentials. launchd then:

1. starts Cognee's isolated Ollama instance and pulls `nomic-embed-text:latest`
   if it is missing
2. starts the Cognee API
3. downloads and builds the matching production UI
4. starts the Caddy loopback gateway

The Python install and UI build can take several minutes on the first start.
Check detailed health and show the generated login with:

```bash
cognee-status
cognee-credentials
```

Open the external origin and sign in. Create an agent API key on the API Keys
page after login. API keys are stored only as hashes, so save the displayed raw
key immediately.

No Cognee MCP servers are registered yet. Add agent integrations only after an
API key exists, and point them at the external origin or the loopback gateway
instead of launching another Cognee instance.

## Tailscale Setup

The host declaration configures the local `tailscale serve` endpoint, but the
tailnet must also authorize the Service:

1. create the `svc:cognee` Service in the Tailscale admin console
2. create a host tag such as `tag:cognee-host` and assign it to
   `popemkt-personal`; Tailscale Service hosts must be tagged nodes
3. approve `popemkt-personal` as a host for the Service, or configure
   `tag:cognee-host` as an auto-approver for `svc:cognee`
4. add grants for the users or devices that should reach `svc:cognee`

Application login remains required even for clients allowed by Tailscale.

## Models

Cognee sends generation requests to CLIProxyAPI:

```text
model:    openai/gemini-3.5-flash-low
endpoint: http://127.0.0.1:8317/v1
mode:     Instructor json_mode
```

CLIProxyAPI must retain its Antigravity OAuth state. Embeddings are generated
locally by a Cognee-only Ollama process on `127.0.0.1:11435` using
`nomic-embed-text:latest` with 768 dimensions. Its model cache is isolated from
the workstation-wide `~/.ollama` state.

## State And Backup

Back up these paths together while Cognee is stopped:

```text
~/.local/share/cognee/data
~/.local/share/cognee/system
~/.local/state/cognee/secrets.env
```

The two share directories contain uploaded content and databases. The secret
file contains the JWT signing material and initial login password. Losing it
invalidates sessions and can make the generated default credentials
unrecoverable.

These paths are rebuildable and do not need normal backup:

```text
~/.cache/cognee
~/.cognee/ui-cache
~/Library/Logs/cognee
```

Ollama models and CLIProxyAPI OAuth state follow their own backup policies.

## Operations

The user agents are `cognee-api`, `cognee-ui`, `cognee-gateway`,
`cognee-ollama`, and `cognee-embedding-model`. Logs live in
`~/Library/Logs/cognee`.

After changing Cognee's version, model, public URL, or service configuration,
run `rebuild`. The UI build marker includes both the Cognee version and public
URL, so relevant changes trigger a clean dependency install and production
build automatically.
