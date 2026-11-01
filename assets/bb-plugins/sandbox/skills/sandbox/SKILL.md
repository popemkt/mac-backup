---
name: sandbox
description: Run code in isolated, resource-capped sandboxes (`bb sandbox`, the sandbox_* tools, or the TypeScript SDK), queued under the machine's budget, and fan agent work out with declarative AgentSpec runs (`bb sandbox agent run spec.yaml`), each in its own sandbox and branch. Use for untrusted or generated code, heavy jobs that must not swamp the host, or bulk agent runs.
---

# Sandbox

A sandbox is an isolated place to run commands: its own `/workspace` (empty, a git checkout on a
new branch, a bound directory, or a snapshot), a private home and `/tmp`, the host's `/nix/store`
read-only, no network unless asked, and CPU, memory and process caps. It does not see `/home`,
`~/.ssh`, bb's data or your checkout. Isolation is Linux namespaces (local `bwrap` provider): good
against accidents and generated code, not a vault for hostile code.

Sandboxes wait in a queue until they fit the host's budget (by default 3 at once, 8 cores, 12 GiB)
and while the host is not under pressure. Every command prints JSON unless said otherwise, and
takes its whole input as `--input '<json>'` or `--input @file.json`.

## One command

```sh
bb sandbox run -- sh -c 'uname -a; ls /'
bb sandbox run --preset node --cpus 4 --memory 4096 -- node -e 'console.log(1 + 1)'
bb sandbox run --git "$PWD" --net open --timeout 900 -- sh -c 'npm ci && npm test'
```

## A sandbox you keep

```sh
id=$(bb sandbox create --git "$PWD" --branch try/thing --preset node | jq -r .id)
bb sandbox write "$id" src/x.ts --content-stdin < x.ts
bb sandbox exec "$id" --timeout 600 -- npm test
bb sandbox read "$id" coverage/summary.txt
bb sandbox destroy "$id"      # the branch (and its commits) stays
```

`bb sandbox create-many --input @specs.json` queues a batch at once; `bb sandbox wait <id>`,
`list --state running --label k=v`, `get`, `snapshot`, `status` (queue and provider capabilities).
A git workspace's `.git` is read-only inside: commit from the host side, in the worktree
`sandbox_get` reports, or let an AgentSpec run do it.

## SDK (TypeScript, from any script on the host)

```ts
import { Sandbox, agents } from "/etc/bb-sandbox/plugin/sdk/index.ts";
await using sb = await Sandbox.create({ image: { preset: "node" }, workspace: { git: { repo: process.cwd() } } });
const r = await sb.exec("npm test", { timeoutSec: 600 });
const boxes = await Sandbox.createMany(specs);   // then: await box.ready()
```

## AgentSpec runs (bulk agent work)

One YAML/JSON file declares a run: harness and model (never Fable), instructions and guides,
sensors, the sandbox (image, resources, network), the workspace (a repo at a ref) and outputs. A
`matrix` fans it out: `${key}` is substituted, and `{ dirs: path }` makes one run per directory.

```yaml
schema: bb-sandbox/agent-spec@1
name: describe-${site}
matrix: { site: { dirs: monuments } }
agent: { harness: claude-code, model: claude-sonnet-5-5, timeoutSec: 2400 }
instructions:
  promptFile: prompts/describe.md          # relative to this file
  guides: [{ file: STYLE.md }]
sensors:
  - { name: lint, run: [npm, run, lint] }
  - { name: score, kind: eval, run: [node, eval.js, "monuments/${site}"] }   # last line {"reward": x}
sandbox: { image: { preset: node }, resources: { cpus: 2, memoryMiB: 4096 } }
workspace: { git: { repo: ., ref: main } }
outputs: { artifacts: ["monuments/${site}/*.png"] }
```

```sh
bb sandbox agent run specs/describe.yaml --batch describe
bb sandbox agent list --batch describe-1a2b3c     # state, branch, sensors, reward, tokens
bb sandbox agent get run-…                         # full record; files under its dir
bb sandbox agent cancel --batch describe-1a2b3c
```

Each run gets a sandbox whose workspace is a worktree on `sandbox/<batch>/<name>`, an agent
thread (a child of yours) working in it on the host, then the sensors inside the sandbox. It
keeps `trajectory.json` (ATIF), `events.jsonl`, `patch.diff` (uncommitted leftovers),
`sensors.json` and `artifacts/` under `~/.local/state/bb-sandbox/runs/<batch>/<name>/`; the
branch keeps the agent's commits. Review the branches; nothing is merged or pushed.

## Limits

- No secrets enter a sandbox; a spec asking for `secrets` is refused by this provider.
- Egress is `none` or `open`; allowlists need a provider with an egress proxy (not built yet).
- Caps are enforced when the host policy names a slice (the `sandboxes` NixOS stack does);
  without it only timeouts apply, and `bb sandbox status` shows `enforces: []`.
- The `sandbox_*` tools are offered to threads an agent run started (or to every thread with the
  `toolsForAllThreads` setting); the CLI works everywhere.
