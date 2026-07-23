# External System Setup

`system-setup` is the operator interface for machine requirements that cannot
be completed inside a Nix build: OAuth grants, device enrollment, SaaS control
plane approval, generated API keys, and live service readiness.

Nix still owns the application, its Python runtime, and the per-host manifest.
Only authorization ceremonies and the mutable state they produce remain
outside the Nix store.

The manifest is an evidence graph compiled by Nix and traversed by Python.
Components identify the things taking part, integrations identify prerequisites
or source-to-target connections, and checks provide live evidence. For example:

```text
Cognee --generation request--> CLIProxyAPI --OAuth--> Antigravity
Cognee --embedding request----> Ollama
```

The connection declaration alone does not claim reachability. Its check must
exercise the relationship from a relevant context. Cognee's generation
connection therefore checks `/health/detailed`, including the LLM provider and
embedding service, while a remote Cognee client checks from that client machine.

Nix declares components, connections, dependencies, immutable commands, and
expected state paths. Python checks the live evidence and blocks downstream
nodes until their prerequisites are ready. Provider tokens never enter the Nix
store or manifest. The standalone `agy` CLI has separate OAuth state and is not
a Cognee prerequisite.

## Ownership Boundary

| Concern | Owner |
|---|---|
| Python 3.13 runtime and application package | Nix + `uv2nix` |
| Exact Python dependency graph | `tools/system-setup/uv.lock` |
| Integration schema and manifest renderer | `modules/darwin/system/system-setup/default.nix` |
| AI connective tissue | `modules/stacks/ai-agents/system-setup.nix` |
| VPN connective tissue | `modules/stacks/vpn/system-setup.nix` |
| Generated host manifest | `/etc/system-setup/integrations.json` |
| OAuth tokens, API keys, device keys | Provider-owned mutable state |
| Tailscale Service creation and host approval | Tailscale control plane |
| Databases and user knowledge | Backup system |

The manifest may contain commands, public endpoints, and paths where mutable
state is expected. It must never contain secret values. Checks report only
readiness and non-secret diagnostics; they do not print credential contents.

Mackup-managed application files remain backup payload rather than integration
nodes. Add backup state to this graph only when restoration is an explicit,
verifiable prerequisite for another component. Mackup's own inventory remains
the source of truth for what it carries.

## Commands

```bash
system-setup status                 # read-only report; exit 2 if required work remains
system-setup status --advisory      # read-only report; incomplete setup still exits 0
system-setup status --json          # stable machine-readable report
system-setup validate-manifest      # schema and graph only; no live checks
system-setup next                   # explain the first unresolved required action
system-setup enroll <integration>   # explicitly run/open one enrollment action
system-setup verify                 # require all mandatory integrations to be ready
system-setup verify <integration>   # verify one integration
system-setup verify --all           # include optional integrations
```

Exit code `0` means the requested check succeeded. Exit code `1` means the
manifest or check machinery failed. Exit code `2` means setup is valid but an
operator action is still required. `--advisory` changes only the incomplete
status exit from `2` to `0`.

`status`, `next`, and `verify` never modify the machine. `enroll` is the only
mutating command and must be invoked explicitly. It refuses command-based
enrollment without an interactive terminal and will not run an action whose
declared dependencies are unresolved.

Every successful `rebuild` ends with `system-setup status --advisory`, so
missing external state remains visible without making routine activation fail.
Enrollment stays separate because OAuth and third-party approvals require user
intent and sometimes a browser or administrator.

The manifest itself is different from live readiness: its Pydantic schema and
dependency graph are validated in a Nix derivation before the Darwin generation
can switch. Unknown dependency/component references are rejected during Nix
evaluation, and malformed or cyclic generated graphs fail during the build.

## Restore and Reauthentication

After the first rebuild, run:

```bash
system-setup status
system-setup next
```

Follow `next`, enroll that integration, and repeat until `system-setup verify`
succeeds. The dependency graph orders prerequisites, for example signing a
device into Tailscale before approving a Tailnet Service.

An integration's declaration records its mutable state paths, secret policy,
and recovery procedure. Use that metadata with `docs/backup-strategy.md`:

- restore databases and durable user data from backup;
- restore protected credential state only when the provider supports safe
  transfer and the backup is encrypted;
- otherwise reauthenticate and revoke superseded credentials;
- recreate third-party control-plane objects from the tracked instructions.

## Adding an Integration

1. Add or reuse components in a `system-setup.nix` companion beside the stack
   that owns their configuration.
2. Add the integration under an attribute key; that key is its stable ID.
3. Declare every concrete source-to-target edge in `connections`; one
   integration may prove multiple edges. Declare prerequisite integration IDs
   in `dependsOn`.
4. Declare the non-secret check, enrollment action, state paths, secret policy,
   and recovery text. A connection check must exercise the relationship rather
   than merely confirm that both endpoints exist.
5. Prefer an existing check kind. Add a discriminated Pydantic model and tests
   under `tools/system-setup/` only when a new protocol is necessary.
6. Run `nix flake check`. Nix rejects unknown component/dependency references,
   while per-host manifest checks validate cycles and the complete generated
   Pydantic schema without contacting live services.

The source package uses Pydantic for strict manifest validation, Typer and Rich
for its CLI, Ruff for linting and formatting, Pyrefly for static typing, and
pytest for behavior tests. Development dependencies are locked by uv, then
built and tested hermetically through Nix rather than installed into the live
runtime with `uv run`.
