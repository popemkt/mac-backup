# Agent Notes

## Rule 1 — Abstraction before addition

This is the first rule and it outranks every other consideration in this repo:
speed, diff size, and "it already works" all lose to it.

Every change lands as a clean abstraction. Nothing gets bolted onto the side of
an existing one. When new behavior does not fit the current model, the job is to
fix the model, not to special-case around it.

Before writing code:

- Name the concept the change is actually about, then find where that concept
  already lives. If it lives in two places, collapse them **first**.
- Prefer deleting a special case to adding one. A second `if` on the same
  distinction means that distinction belongs in the data or the type, not at
  the call site.
- One mechanism per concept, and one place that owns it. No parallel path that
  "also" does the thing — no `fooV2`, no `handleSpecialFoo`, no second picker
  for an enum that already has one.
- If a token, option, or module exists for a purpose, make it actually apply.
  A declared abstraction that no code path reads is worse than none, because it
  reads as covered.
- If the clean version is too big for the moment, say so and stop. Do not ship
  the patch as a stopgap. A named gap is cheaper than a silent fork.

Corollary for the knowledge base: **everything is a node.** New capability is
expressed as nodes, fields, and tags behaving like every other node — never as
a bespoke surface standing beside them. A tag is a node that is tagged as a
tag; a field is a node; a field's allowed values are nodes. If a feature needs
its own widget, its own storage shape, or its own editing gesture, that is the
signal the model is wrong, not that the widget is needed.

## Gate (run first)

This repo is the durable record of an intent => behavior translation process.
Admission is gated. Before doing any work here, run:

```bash
intent/gate.sh session <your-harness-name>
```

Non-zero exit means required tools are missing — restore the environment first
(`rebuild`, or `nix develop`) instead of working around it. All interaction
surfaces and their shims are listed in `intent/SURFACES.md`; commits are
independently gated by `.githooks/pre-commit` (record admission).

Start with the docs in [docs/](/Users/popemkt/.dotfiles/docs) before making structural changes.

Relevant docs:
- [backup-strategy.md](/Users/popemkt/.dotfiles/docs/backup-strategy.md): what should be declarative, what should be backed up as state, and how to decide where new app data belongs
- [nix-concepts.md](/Users/popemkt/.dotfiles/docs/nix-concepts.md): core Nix model for this repo
- [home-manager-options.md](/Users/popemkt/.dotfiles/docs/home-manager-options.md): user-level config patterns
- [nix-darwin-options.md](/Users/popemkt/.dotfiles/docs/nix-darwin-options.md): macOS-specific config patterns
- [troubleshooting.md](/Users/popemkt/.dotfiles/docs/troubleshooting.md): common recovery steps
- [ci.md](/Users/popemkt/.dotfiles/docs/ci.md): what CI gates, what it deliberately
  does not gate and why, and the one manual step left (branch protection)
- [tailscale.md](/Users/popemkt/.dotfiles/docs/tailscale.md): policy ownership,
  GitHub OIDC enrollment, and every remaining manual Tailscale control-plane
  step

Working rule:
- Treat this repo as the source of truth for intentional system configuration.
- Treat user data, application state, databases, caches, and agent memory as backup concerns unless explicitly modeled here.

## Overview

Declarative macOS configuration built with nix-darwin, Home Manager, Homebrew,
and Mackup.

## Commands

```bash
rtk rebuild
rtk nix flake update && rtk rebuild
rtk nix flake check
rtk nix run .#github-sources -- check
rtk nix run .#github-sources -- verify
rtk nix run .#github-sources -- update
rtk ./scripts/uv-sources check
rtk ./scripts/uv-sources update
rtk mackup backup
rtk mackup restore
```

`rebuild` applies the configuration and upgrades Homebrew plus tracked npm and
Bun globals. The GitHub-sources commands check, verify, or refresh direct
GitHub release pins.

## kb — repo knowledge base

`kb` (code in `tools/kb/`, specs in `tools/kb/DESIGN.md`,
`tools/kb/DESIGN-UI.md`, and `tools/kb/DESIGN-REFINE.md`) is this repo's
outliner datastore: todos, notes, and
any structured facts live as nodes in `.kb/nodes.jsonl` (committed).
Everything is a node — fields and tags too. Props are keyed by field-node id;
tags template fields; values may reference other nodes. Query with datalog
(DataScript), or via the MCP server registered in `.mcp.json` (tools
`node_add`, `graph_query`, `kb_manifest`, `render_view`, plus `ui://kb/view/*`
html resources). `kb ui` serves the human outliner UI on 127.0.0.1:4321
(Tana-style editing, ⌘K palette, inline markdown + `[[id|label]]` ref links,
inline fields, query nodes — a `#query`-tagged node with a `sys.f.query` EDN
prop renders live results while expanded — media via `![](assets/…)` backed
by `.kb/assets/` (Mackup-owned backup, never committed; see
`docs/backup-strategy.md`) and the `asset.upload` action, live WS updates);
other apps
can subscribe to live datalog queries over its `/ws` endpoint (see protocol in
`tools/kb/packages/contracts/src/protocol.ts`). `sys.*` nodes are write-guarded (CLI
`--force` to override).

```bash
kb add "Fix drift audit" --tag todo --prop status=doing   # alias for bun tools/kb/packages/cli/src/main.ts
kb search "drift" --json
kb query '[:find ?id ?text :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :node/id ?id] [?n :node/text ?text]]'
kb query '[:find ?from ?text :where [?e :node/mentions ?m] [?m :node/id "n.root-a"] [?e :node/id ?from] [?e :node/text ?text]]'
kb run <saved-query>            # .kb/queries/<name>.edn
kb field type <field> <text|number|date|url|checkbox|ref>
kb field target <field> <tag>            # ref constraint sugar (union)
kb field target-query <field> '<edn>'    # general form; wins over targetTag
kb action-invoke '{"id":"docs.materialize","input":{}}'   # regenerate docs/kb/*
kb ext list                     # loaded extensions + their actions
```

Core is mechanism only (store, datalog, registry, subscriptions, render
backbone). Repo-specific policy lives in extensions: `.kb/extensions/*.ts`
modules default-exporting an array of contributions — actions
(`{...ActionDefinition, handler}`) and render templates (`{id, template}`) —
each registered as `ext.<file>.<id>`; loader failures warn and skip, never
crash core. The bundled example `@kb/ext-docs` (`tools/kb/packages/ext-docs`)
owns `ext.docs.materialize`/`ext.docs.check` and the template
`ext.docs.todos` (the bare ids `docs.materialize`, `docs.check` and `todos`
remain as aliases, so pre-commit and existing view specs are unchanged).

Rules for agents:
- Prefer `kb` over ad-hoc TODO files for durable repo todos/notes; `--json` for machine output.
- Props are multi-valued: `set` appends — `unset` the old value when changing e.g. `status`.
- `[[id|label]]` in node text and any `{t:"ref"}` prop value are both the ref form; load extracts `:node/mentions` datoms from either (see `tools/kb/DESIGN.md`). Use `kb backlinks <id>` or the datalog example above.
- `docs/kb/*.md` is generated (header marks it); edit data, then materialize.
  Pre-commit runs `docs.check` and blocks stale generated docs.
- Workspace: `tools/kb` is a Bun workspace; every concept is a package under
  `tools/kb/packages/<name>` named `@kb/<name>`, with one curated barrel at
  `src/index.ts` and two tags (`layer:*`, `scope:*`) in its `nx` key. There is
  no alias map — `@kb/*` resolve as workspace packages. Internal deps are
  `workspace:*`, external deps are `catalog:`, and the catalog in the root
  `package.json` is the only file that names a version.
- Runtime/tooling boundary: Bun is the production runtime (Bun APIs stay where
  appropriate); TS 7 + Vite+ (`vp` 0.2.8) + oxlint + Nx own the tooling. Run
  `bun run verify` (typecheck + lint + knip + harness — the entry point a human
  or CI runs), `bun run typecheck` (authoritative zero-error `tsc --noEmit` per
  package via Nx, also in pre-commit when `tools/kb/` changes), `bun run test`,
  `bun run test:ui`. Two runners split by package: everything but `@kb/ui` runs
  on `bun test`; the browser package runs on Vitest. See `tools/kb/DESIGN.md`.
- Linting & boundaries (`tools/kb`): layer and scope direction are enforced by
  `tools/kb/packages/harness` over what the code imports; the matrix is stated
  once in `packages/harness/src/constraints.ts`. `tools/kb/.oxlintrc.json` is
  the single oxlint ruleset and owns the one fence the package graph cannot
  see: a `scope:shared` package may not import `node:*`, `bun:*`, or
  `@effect/platform-bun`.

## Where To Edit

| Intent | Location |
|---|---|
| Add software belonging to a functional stack | `modules/stacks/<stack>` and its matching `my.pkgs.*` channel list |
| Add a functional stack | Declare `options.my.stacks.<name> = mkStack { ... }`, add its config, import it from `modules/stacks/default.nix`, then enable it in `hosts/<hostname>/default.nix` |
| Add an unpacked browser extension checkout | `modules/stacks/browsers/` + `system-setup enroll <id>`; Load unpacked stays manual |
| Add an unpacked browser extension checkout | `modules/stacks/browsers/` + `system-setup enroll <id>`; Load unpacked stays manual |
| Add a CLI tool without a stack fit | `modules/common/home-manager/packages.nix` |
| Add a GUI cask without a stack fit | `modules/darwin/system/homebrew.nix` → `homebrew.casks` |
| Add a brew formula without a stack fit | `modules/darwin/system/homebrew.nix` → `homebrew.brews` |
| Add a macOS system setting | `modules/darwin/system/default.nix` → `system.defaults` |
| Add a shell alias | `modules/common/home-manager/shell.nix` |
| Add macOS-only Home Manager config | `modules/darwin/home-manager/default.nix` |
| Change Git config | `modules/common/home-manager/git.nix` |
| Add an npm global | `modules/common/home-manager/npm-global.nix` |
| Add a uv tool | the owning module's `uvTools`, plus an entry in `_sources/uv-pins.json` |
| Hold a uv tool at a version | set `track = "manual"` on its `_sources/uv-pins.json` entry |
| Add a Bun global | `modules/darwin/home-manager/bun-global.nix` |
| Add a Claude Code or Codex plugin | the owning stack's `my.pkgs.{claude,codex}{Marketplaces,Plugins}` lists |
| Add host-only config | `hosts/<hostname>/default.nix` |
| Add a work/personal split | `lib.mkIf (config.my.role == "work") { ... }` in the owning system module |
| Add a direct GitHub release package | `nvfetcher.toml` and `pkgs/`; see `docs/github-release-packages.md` |

Run `rtk rebuild` after a change that should affect the live system.

## Module Boundaries

The repo has two axes, and every module belongs to exactly one of them.

- **Vertical (semantic encapsulation).** A stack under `modules/stacks/` owns
  one functional slice end to end: its option schema, daemons, activation,
  scripts, and package membership. A component that grows past a single file
  gets its own folder inside the stack (`ai-agents/cognee/`), not a prefixed
  sibling. Nothing outside a component should reach into its option subtree to
  decide membership — the component declares its own contributions.
- **Horizontal (cross-cutting mechanism).** A channel in `modules/options/pkgs.nix`
  is a typed merge target, and its executor installs whatever lands there. Stacks
  decide membership; executors never do. Adding software means adding to a
  channel from the owning stack, never editing an executor.

### Writing an executor

Activation runs with a minimal environment. It inherits no interactive PATH,
so an executor that shells out to a package manager must supply that tool's
environment itself. Three rules, each learned from a real breakage:

- **Invoke the tool by absolute path.** `${pkgs.nodejs}/bin/npm`,
  `/opt/homebrew/bin/brew`, `/opt/homebrew/bin/bun`. Where the tool is owned by
  Homebrew or npm and has no store path, declare the runtime it needs with
  `lib.makeBinPath` rather than assuming PATH — an npm-installed CLI is
  usually `#!/usr/bin/env node` and dies without one.
- **Never read a failed probe as an empty result.** Capture the listing and
  check the exit status. `cmd list | grep -q x` treats "command crashed" and
  "nothing installed" identically, which makes an executor reinstall things
  that already exist.
- **Converge best effort.** Homebrew, npm, and Bun install their CLIs during
  the same rebuild, so on a fresh machine a downstream executor may legitimately
  find nothing to run. Warn and continue; never abort activation over an
  optional package.

Failing soft is only safe because the drift audit closes the loop: whatever
did not converge shows up under "Tracked But Missing" in
`scripts/audit-system-discrepancies.sh`, which `rebuild` runs. Prefer that pair
over trying to make activation itself infallible.

Group by behavior and ownership boundary, not by app count.

- One-line installs stay in the relevant package list.
- If an app needs install entries plus config files, activation hooks, launchd
  services, defaults writes, symlinks, or dependencies across multiple places,
  create a focused module for that behavior.
- Keep cross-platform behavior in `modules/common/home-manager/`, Home Manager
  macOS user behavior in `modules/darwin/home-manager/`, and nix-darwin system
  behavior in `modules/darwin/system/`. `common` means cross-platform reuse,
  not configuration automatically applied to every local user.
- Host-specific differences belong in `hosts/<hostname>/default.nix`.

### Stack enable vs component gates

`imports` only merges modules into the evaluation. It does not turn them on.
Behavior is gated with `mkIf` against options from `mkStack`.

- **Stack gate** (`my.stacks.<name>.enable`): core always-on behavior for that
  stack. Prefer this for siblings that are inseparable from the stack itself
  (e.g. `ai-agents` → CLIProxyAPI, Headroom, Hermes).
- **Component gate** (`componentOptions` on `mkStack`): optional, host-split, or
  mutually exclusive pieces (e.g. `ai-agents.ollama`, `ai-agents.archon`,
  `ai-agents.cognee.{server,client}`, `vpn.services.<name>`).

Leaves may read their own stack/component option path. They must not reach into
another component's option subtree to decide membership. Hosts flip stack and
component switches in `hosts/<hostname>/default.nix`; they do not open sibling
module internals.

## Lint And Format

Before suggesting commits, ensure changed Nix files pass:

```bash
rtk nixfmt **/*.nix
rtk statix check .
rtk deadnix --fail --exclude ./_sources/generated.nix .
rtk nix flake check --no-build
```

The pre-commit hook at `.githooks/pre-commit` runs these checks on staged files.
It is activated with `git config core.hooksPath .githooks` on this clone.

When adding modules, prefer `_:` over `{ ... }:` when no arguments are used;
statix flags empty patterns. Use `{ pkgs, ... }:` only when `pkgs` is actually
referenced.

## Architecture

- `flake.nix` is the entry point. `mkDarwin` builds one configuration per host;
  each attribute name is the hostname.
- `modules/options/` contains cross-cutting typed options only:
  `my.{username,hostname,role}` and `my.pkgs.*` channel merge targets. System
  modules read `config.my.*`; Home Manager reads `osConfig.my.*`. Per-stack
  options live with their stack, not here, and do not use `specialArgs`.
- `modules/stacks/` is the intent layer: vertical functional slices such as
  `ai-agents/`, `office-docs.nix`, and `vpn/`. Each stack owns its option schema,
  config, sibling daemons, and package-channel contributions. `mk-stack.nix`
  provides `enable`, optional component toggles such as `ai-agents.ollama` or
  `vpn.services`, and host additions through `extra.*` mirroring the channels
  in `modules/options/pkgs.nix`; everything except `enable` is defaulted. A package may belong to multiple stacks. Homebrew, npm, and Bun
  executors merge contributions with `lib.unique`; Home Manager executors read
  them through `osConfig.my.pkgs.*`. A stack may be one file or a directory with
  `default.nix` and focused siblings.
- `modules/darwin/system/` is the shared macOS base. AI service daemons belong
  to the `ai-agents` stack rather than this directory; this layer owns system
  defaults, the Homebrew executor, input sources, and the external workspace.
- `hosts/popemkt-work/` and `hosts/popemkt-personal/` set role and host-only
  differences on top of the shared Darwin modules.
- Renaming a machine requires renaming its host directory and flake attribute,
  then running `rtk rebuild --flake ~/.dotfiles#<newname>` once. Activation sets
  HostName, ComputerName, and LocalHostName through `networking.*`.
- `modules/common/home-manager/` owns cross-platform user configuration.
- `modules/darwin/home-manager/` owns macOS-specific user behavior.
- `modules/nixos/home-manager/` is the future Linux-specific layer and is not
  currently built.
- `pkgs/` and `_sources/` contain custom packages backed by nvfetcher-managed
  GitHub release pins.
- `configs/` contains raw application configuration.
- Use `lib.optionals pkgs.stdenv.isDarwin [ ... ]` and
  `lib.mkIf pkgs.stdenv.isLinux { ... }` for platform conditionals.

## Gotchas

- The Determinate Nix installer requires `nix.enable = false` in nix-darwin.
- `system.primaryUser` comes from `config.my.username` in `flake.nix`.
- `homebrew.onActivation.cleanup = "none"` preserves unlisted applications;
  `"zap"` would enforce strict removal.
- Touch ID sudo is configured through
  `security.pam.services.sudo_local.touchIdAuth`.

## Repository Identity

- System: Apple Silicon Mac (`aarch64-darwin`)
- GitHub: `popemkt`
- Name: Hoang Nguyen Gia
- Email: `hoangng71299@gmail.com`

## Commit Style

Use `<type>: <short description>` with `feat`, `fix`, `docs`, `refactor`, or
`chore`.
