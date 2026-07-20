# Cognee Service

Cognee 1.4.0 runs as an authenticated private service on the personal Mac.
The machine configuration owns the deployed version, process supervision,
loopback routing, local model dependencies, and Tailscale exposure. Cognee's
databases and credentials remain mutable state and must be backed up separately.

## Endpoints

The external origin is:

```text
https://cognee.<tailnet-id>.ts.net
```

The concrete `<tailnet-id>` is declared once in `hosts/tailnet.nix`. Both the
service host and remote clients derive their origin from that file, so moving
to another tailnet remains a one-line change.

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

The first activation installs `cognee[ollama]==1.4.0` and
`cognee-mcp==0.5.4` in one uv tool environment and generates credentials.
launchd then:

1. starts Cognee's isolated Ollama instance and pulls `nomic-embed-text:latest`
   if it is missing
2. starts the Cognee API
3. downloads and builds the matching production UI
4. starts the Caddy loopback gateway
5. starts the loopback MCP gateway after its agent API key has been provisioned

The Python install and UI build can take several minutes on the first start.
Check detailed health and show the generated login with:

```bash
cognee-status
cognee-credentials
```

Open the external origin and sign in to verify the browser UI. Then provision
one private agent key and configure every supported local agent with:

```bash
cognee-agent-setup
```

The command is idempotent. It validates or creates the key, starts the shared
MCP gateway, merge-adds Cognee without removing other MCP servers, enables the
Codex hooks feature, and installs Cognee's Codex and Claude Code lifecycle
plugins. It also pins both plugins to the self-hosted origin in their local
plugin config, preventing a GUI agent process with stale environment variables
from falling back to Cognee's separate `localhost:8011` development server.
Restart active agent sessions afterward.

## Home Server And Remote Clients

`popemkt-personal` is the sole Cognee server. It owns the API, UI, databases,
graph processing, embeddings, model calls, and backups. Other Macs do not run
another Cognee database or model stack. They run only `cognee-mcp==0.5.4` as a
loopback protocol bridge and point their lifecycle plugins at the central HTTPS
origin.

```text
remote agent -> 127.0.0.1:8001/mcp -> Tailscale HTTPS -> home Cognee
remote browser ---------------------> Tailscale HTTPS -> home Cognee UI
```

The local bridge keeps API keys out of Cursor, OMP, and Hermes configuration
files. It stores one per-machine key at:

```text
~/.local/state/cognee/agent-api-key
```

`popemkt-work` declares the client role with lifecycle dataset `work`. After
applying that host's configuration, enroll and verify it from a terminal on the
work Mac:

```bash
rebuild
cognee-client-enroll
cognee-client-status
```

Enrollment registers or signs into a Cognee account, creates an API key named
`agent-popemkt-work`, stores only that key, and configures all five agents.
Passwords are not retained. Restart active Codex, Claude Code, Cursor, OMP, and
Hermes sessions after enrollment.

Use a distinct Cognee account for the work Mac if work knowledge must be
authorization-isolated from personal agents. A distinct dataset name alone
controls normal plugin recall but is not a security boundary for API keys owned
by the same Cognee user. Confirm company policy before sending employer data to
a personally administered machine, even though transport remains inside the
tailnet.

To add another machine, enable `my.stacks.ai-agents.cognee.client`, choose its
dataset, rebuild it, and enroll it. Use one API key per machine so a lost device
can be revoked independently. `cognee-client-enroll --replace` rotates the
local key; revoke the superseded key from Cognee afterward.

Only Cognee knowledge processing is centralized. The coding agents themselves
and any provider-backed inference they invoke continue to run according to
their own configuration.

## Agent Integrations

Cognee uses two integration styles:

| Agents | Integration | Automatic session trace | Shared graph memory |
|---|---|---:|---:|
| Codex, Claude Code | Cognee lifecycle plugin | Yes | Yes |
| Cursor CLI, Oh My Pi, Hermes | Streamable HTTP MCP | No | Yes |

The lifecycle plugins capture prompts, tool traces, and assistant output. They
recall relevant context when a prompt is submitted and sync the session into
graph memory at session end, so these conversations appear in the Cognee
Sessions UI.

MCP clients expose explicit Cognee memory tools. They can search and update the
same graph, but Cognee does not currently ship lifecycle hooks that upload the
complete Cursor, OMP, or Hermes conversation timeline.

### Future: lifecycle tracing for MCP-only agents

TODO: add thin, local lifecycle adapters for Cursor CLI, Oh My Pi, and Hermes
that mirror the behavior of Cognee's Codex and Claude Code plugins. All three
clients expose the events needed to do this without relying on the model to
remember to call an MCP tool:

- Cursor: `sessionStart`, `beforeSubmitPrompt`, `postToolUse`,
  `postToolUseFailure`, `afterAgentResponse`, and `sessionEnd` hooks
- Oh My Pi: `session_start`, `before_agent_start`, `tool_execution_end`,
  `message_end`, and `session_shutdown` extension events
- Hermes: `on_session_start`, `pre_llm_call`, `post_tool_call`,
  `post_llm_call`, and `on_session_finalize` shell hooks

The adapters should assign one stable, agent-prefixed Cognee session ID per
native conversation; recall context before each prompt; submit paired Q&A and
structured tool traces to `/api/v1/remember/entry`; call `improve` when the
session ends; and preserve native resume semantics. They must be asynchronous
or tightly time-bounded, fail open when Cognee is unavailable, redact likely
credentials, and apply the same field-size caps as the upstream plugins before
persisting tool inputs or outputs. Subagents, retries, compaction, duplicate
events, and abrupt process termination need explicit test coverage.

Until that work lands, the Sessions UI is a complete automatic trace only for
Codex and Claude Code. Cursor, OMP, and Hermes may create partial sessions when
they explicitly use Cognee tools with a stable `session_id`, but the MCP
connection alone is not a lifecycle recorder.

On the server host all five agents use `main_dataset`; the work client uses
`work` for its Codex and Claude lifecycle plugins. A dataset is the durable
searchable graph; a session is the traceable prompt/tool/answer timeline that
the lifecycle plugins capture. Choosing a dataset does not disable Sessions.

MCP tools accept their dataset on each call (`dataset_name` for writes and
`datasets` for recall/search); the MCP protocol has no client-wide dataset
setting in `cognee-mcp==0.5.4`. On the work machine, MCP-only agents should pass
`work`. A separate work user remains the reliable authorization boundary if an
agent supplies another dataset name.

One unauthenticated but loopback-only MCP process listens at:

```text
http://127.0.0.1:8001/mcp
```

It holds the Cognee API key server-side and connects to the authenticated
external Cognee origin. Cursor, OMP, and Hermes configs therefore contain only
the loopback URL, not a secret or another Cognee database. Their generated
config locations are:

```text
~/.cursor/mcp.json
~/.omp/agent/mcp.json
$HERMES_HOME/config.yaml
```

The live Integrations page currently emits `COGNEE_BASE_URL` in MCP snippets,
but `cognee-mcp==0.5.4` reads `COGNEE_SERVICE_URL`. It also cannot recover a
self-hosted API key because the 1.4.0 frontend key helper returns an empty
value. `cognee-agent-setup` handles both self-hosting differences.

Known upstream limitation: in `cognee-mcp==0.5.4` serve mode, administrative
tools such as `list_data` and dataset deletion still take a local-database code
path. Use the Cognee UI or authenticated API for dataset administration. The
remote `remember`, `recall`, `search`, and session-memory routes use the shared
self-hosted service.

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
Grant the work device or user access to `svc:cognee`; it does not host or
advertise a Tailscale Service itself.

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
~/.local/state/cognee/agent-api-key
```

The two share directories contain uploaded content and databases. The secret
file contains the JWT signing material and initial login password. Losing it
invalidates sessions and can make the generated default credentials
unrecoverable. The agent API key is the recoverable source for the derived
`~/.cognee-plugin/api_key.json` used by the Codex and Claude plugins; both files
must remain mode `0600`.

These paths are rebuildable and do not need normal backup:

```text
~/.cache/cognee
~/.cognee/ui-cache
~/Library/Logs/cognee
```

Ollama models and CLIProxyAPI OAuth state follow their own backup policies.

## Operations

The user agents are `cognee-api`, `cognee-ui`, `cognee-gateway`, `cognee-mcp`,
`cognee-ollama`, and `cognee-embedding-model`. Logs live in
`~/Library/Logs/cognee`.

The personal host disables computer sleep and enables restart after power loss;
display sleep remains unchanged. Cognee currently uses per-user launchd agents,
so the `popemkt` login session must remain active and a reboot does not restore
Cognee until that account logs in. FileVault may also require a local disk
unlock after an unattended power failure. Once the user session exists,
Tailscale and the KeepAlive jobs recover independently. Remote clients fail
closed when the home host is offline and recover without re-enrollment when it
returns.

Time Machine currently includes both Cognee state roots, but a live collection
of SQLite, Ladybug, and LanceDB files is not guaranteed to be point-in-time
consistent. Keep the documented stopped-service backup as the disaster-recovery
copy; remote machines intentionally hold no second copy of the knowledge base.

After changing Cognee's version, model, public URL, or service configuration,
run `rebuild`. The UI build marker includes both the Cognee version and public
URL, so relevant changes trigger a clean dependency install and production
build automatically.
