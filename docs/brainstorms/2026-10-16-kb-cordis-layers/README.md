# What DeepSeek Harness adds on top of Cordis, and what kb should take

Survey of 2026-10-16 for the queue item "Investigate the layers DeepSeek
Harness adds on top of Cordis". It feeds "Cordis-level plugin integration"
(config as fields on `sys.extension.<name>` with re-apply, a graph-driven
loader, a plugin view, hot reload, optional injects, lifecycle events) and
"Sidebar agent config as fields on the agent's extension node". It decides
nothing; the ranking is a recommendation.

Sources: kb's `DESIGN.md`, `tools/kb/packages/domain/plugin/src/`, and the
projection-families plan; external repositories fetched 2026-10-16 with
`gh api` (main branch). A claim I could not find in source says so.

## What it is

**DeepSeek Harness ("dsh") exists.** An agent harness by DeepSeek AI, MIT,
"developer preview" with a stated warning of compatibility-breaking changes.
Repository description: "DeepSeek Harness: Everything is a Plugin."

- Repository: https://github.com/deepseek-ai/deepseek-harness. Its README:
  "built on an everything-is-a-plugin architecture and powered by Cordis".
- Docs site (linked from the README, not fetched):
  https://deepseek-harness.github.io/deepseek-harness/ . The product page
  https://deepseek.com/harness redirects and I could not read it; the
  2026-08-13 preview date is from kb's older note
  (`docs/kb/waves/2026-09-23/briefs/p1-plugins.md`), not the README.
- Its statement of the relationship, "the vendored plugin framework
  underneath DeepSeek Harness":
  https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/cordis-primer.md
- Not related: a Product Hunt listing "Cordis Plugin", a third-party plugin
  directory for dsh (search snippet only, not fetched).

**Cordis** is a separate project: https://github.com/cordiverse/cordis (MIT,
"A Meta-Framework of Spatiotemporal Composability", API "not yet stable").
Packages: `core`, `create`, `group`, `hmr`, `include`, `loader`,
`logger-console`, `timer`. Upstream main is `4.0.0-rc.11`. Paper: Shi, Zhang,
Cui (Peking University and DeepSeek-AI), "A Programming Paradigm for
Spatiotemporal Composability", https://arxiv.org/abs/2608.25512. It names two
properties: temporal composability (removing a component fully reverts its
side effects) and spatial composability (declared, reactively managed
dependencies). The Cordis README is two lines, so the mechanics below come
from source.

**Relationship.** Harness does not take Cordis from npm. It source-vendors
Cordis `4.0.0-rc.7` and satellites under the `@deepseek-ai` scope with 24
logged local modifications
(https://github.com/deepseek-ai/deepseek-harness/blob/main/vendor/README.md);
a proposed rc.11 upgrade retires some
(https://github.com/deepseek-ai/deepseek-harness/blob/main/vendor/cordis-rc11-upgrade-plan.md).

Not found: a `reusable` plugin flag. I searched core, loader, include, hmr,
group and timer sources for it and found nothing, so I do not describe it.

## The Cordis core, from source

Base: https://github.com/cordiverse/cordis/blob/main/packages/

- **Plugin** (`core/src/registry.ts`): function, class or `{apply}`, with
  optional `name`, `Config` (a Standard Schema), `inject`, `provide`. Every
  injected name is required: a fiber missing one is inactive and returns when
  it appears (`fiber.ts`). I found no optional form.
- **Fiber** (`core/src/fiber.ts`): states PENDING, LOADING, ACTIVE, FAILED,
  UNLOADING, DISPOSED. `ctx.effect(fn, label)` registers a disposer, run in
  reverse on unload; `getEffects()` lists them. `fiber.update(config)` is the
  re-apply path: it waterfalls `internal/update` with the resolved config and
  a `restart` callback, and a listener may take the change in place and veto
  the restart. A failed fiber recovers only through `update()`.
- **Events** (`core/src/events.ts`): `emit`, `parallel`, `serial`, `bail`,
  `waterfall`. **Context**: `ctx.isolate` gives a subtree its own instance of
  a service name; `ctx.intercept` sets per-subtree service config.
- **Loader** (`loader/src/config/entry.ts`, `tree.ts`): a tree of entries
  `{id, name, config, group, disabled, inject, intercept, isolate}`; the entry
  list is the program. `Entry.update` diffs options: disabled disposes the
  fiber, a changed `config` calls `fiber.update`, else nothing.
- **Satellites**: `include` (a YAML entry list with write-back), `group`,
  `hmr` (module watcher, stale-plugin computation from the module graph),
  `timer` (`timeout`, `interval`, `throttle`, `debounce` as auto-disposed
  effects), `logger-console`.

## The layers Harness adds

Links relative to https://github.com/deepseek-ai/deepseek-harness/blob/main/

1. **An owned, patched framework.** Vendored Cordis with 24 divergences:
   lifecycle hardening (an unload begun inside setup awaits cleanup), lazy
   config resolution after injections activate, `disabled: !!js` evaluated at
   each mount decision, a pure exported `applyEntryPatches` so tooling never
   re-implements patching. `vendor/README.md`.
2. **Profiles, bundles, patch layers.** An app is a plugin tree composed at
   boot from ordered layers: a profile, its bundles (config rows plus the code
   they mount), the profile's `cordis.patch.yml`, a home patch, `--patch`
   overlays. A patch targets a row by id and replaces its config or inserts
   rows. `dsh --dump-config` prints the effective tree without booting.
   `docs/architecture.md`, `packages/boot/app-boot/README.md`.
3. **Config as an edited, revisioned document.** `ctx.settings` projects
   "volatile" Config fields into forms (resolved, inherited and overridden
   values plus a revision); writes validate the whole candidate and refuse
   stale revisions; `config-editor` writes the patch, keeping YAML comments.
   Volatile means a stable reference updated in place without restarting the
   plugin (vendor item 22). `docs/subsystems/settings.md`,
   `packages/boot/config-editor/README.md`.
4. **A reload coordinator.** `dsh-hmr` serializes module replacement, Include
   refreshes and profile-config changes in one queue; a replacement that fails
   to load stops the old plugin and reports `failed`.
   `packages/boot/hmr/README.md`.
5. **Plugin management and admission.** Plugin Manager enables, disables,
   installs and removes bundles through pnpm; admission checks `engines.dsh`
   before a module is imported, with exact-version exemptions;
   `plugin-market` reads configured index files.
   `packages/boot/plugin-manager/README.md`.
6. **A browser half with typed slots.** A package declares `dsh.client`; the
   host composes a boot graph and serves scripts; the browser runs its own
   Cordis. UI goes into slots declared by the owning component, with
   cardinality `single | list | keyed | chain` and scope `root |
   session-maybe | session`; disposing an owner collapses its child slots.
   `docs/subsystems/slots.md`, `docs/subsystems/client-modules.md`.
7. **Per-agent scoped registration.** A scope key (the live agent) makes one
   context mean both visibility and lifetime; a scoped tool or prompt section
   shadows its global twin. `docs/subsystems/scope.md`.
8. **Capability seams.** A swappable capability has a Service Definition,
   Providers and Consumers; "one role alone is not a seam".
   `docs/architecture.md`.
9. **Event and API discipline enforced by tooling.** Each event documents its
   dispatch mode with an `@mode` tag, checked against dispatch sites;
   `gen-cordis-catalog` generates `docs/cordis-api/` and a verify script
   fails when stale. `docs/cordis-primer.md`.
10. **Agent-facing introspection.** `ctx.cordisInspect` lets the model query
    approved runtime metadata before writing plugin code.
    `docs/subsystems/extensions.md`.

Harness's own caveat: Loader tree mutations are "eager, non-transactional"
and do not restore previous plugins on failure (`vendor/README.md`, item 8).

## What kb's `@kb/plugin` already has

Paths under `tools/kb/packages/`.

| Cordis / Harness concept | kb equivalent | Status |
|---|---|---|
| Plugin, `apply(ctx)` | `Plugin`, `domain/plugin/src/kernel.ts` | present |
| Service provide and inject, one provider per name | `ctx.provide`, `ctx.get`, `inject`, `service-conflict` | present |
| Wait for a service; back to pending when it leaves | `reconcile`, `removeService` in `kernel.ts` | present |
| Effects unwound on unload | Effect `Scope` per plugin; failed `apply` is atomic | present, stronger (atomic) |
| Typed names, one meaning each | `Service`, `Point`, `Event`, `keys.ts` (identity-checked) | present |
| Child plugins | `ctx.plugin(child)`, unloads with parent | present |
| Contribution points (slots, `ctx.tools`) | `Point`, `ctx.contribute`, namespaced ids, aliases | present, flat keyed list |
| Reactive read for UI | `subscribe`, `version`, `contributions`, `lookup` | present |
| Converge on a list | `syncPlugins`, `sync.ts` | present |
| Switch a plugin by data | `sys.extension.<name>`, `familyOn`, `contract/contracts/src/extension-switch.ts` | present, one field (`enabled`) |
| Node props to typed config | `ConfigSlots`, `decodeNodeConfig`, `encodeNodeConfig`, `domain/model/src/node-config.ts` | present; used by views and the switch, not by plugin config |
| Loader over an entry list | `registryFor`, `BUNDLED_FAMILIES`, `composeHosted` (`app/runtime/src/registry.ts`, `app/server/src/plugins.ts`) | partial: list in code, switch in data |
| Second kernel in the browser | `syncUiPlugins`, `app/ui/src/ui-plugins.ts` | present |
| Per-plugin status | `kernel.plugins()` (`pending`/`active`/`failed`, `missing`, `error`), `kb ext list` | present, no view |
| `Config` schema, `apply(ctx, config)` | none: "a plugin that takes configuration is a function returning a plugin" | missing |
| Re-apply on config change (`fiber.update`) | none: only unload and load by name | missing |
| `on` and `emit` | in the kernel, exercised only by `domain/plugin/tests/kernel.test.ts`; no production `Event` key | present, unused |
| Optional or late injection | a child plugin with its own `inject` waits and returns | expressible, unnamed |
| Effect labels, `getEffects()` | finalizers unlabelled; contributions record `owner` | missing |
| Hot module reload | none; extensions load once per process (DESIGN.md) | missing |
| `waterfall`, `bail`, `serial`, `parallel` | `emit` order only; failures logged | missing, no caller |
| Isolate, intercept, entry tree, profiles and patch layers, settings forms, plugin manager and market, slot cardinality, per-agent scope | none | missing, see Non-adoptions |
| Generated API catalog, agent introspection | `kb ext sdk`, `kb ext list`, `kb.manifest`, `kb_manifest` MCP tool | partial, present |
| Seam contract suite | `extensionContract` (`app/test-kit`), `sandboxContract` | present for families and one port, not for the kernel |

## Gaps worth taking, ranked

Ranked by value to kb's direction: everything a plugin, outline and graph
becoming families, the graph as the core model. Cost: S under a day, M a few
days, L a week or more.

### 1. Plugin config as fields on `sys.extension.<name>`, with re-apply (M)

Cordis: a `Config` schema plus `fiber.update`, which lets a plugin take the
change in place or be restarted. Harness adds revisioned forms.

In kb terms: the extension node's props, decoded by the existing
`ConfigSlots`, are the plugin's config. `switchSlots` in `extension-switch.ts`
is already the first slot (`enabled`); a family adds slots beside it. The
field nodes are the schema, so there is no second registry. Two classes, after
Harness's "volatile" split:
- read per call (a model name, an executable path): the plugin holds a reader
  over the live node; nothing re-applies;
- read at `apply` time: a kernel `reconfigure(name)` unloads and loads the
  plugin as `syncPlugins` does; an optional `onConfig` handler may take the
  change in place, the analogue of vetoing the restart.
The trigger exists: `composeHosted` converges when the log carries a write to
a switch node; it would watch the whole extension node. A failed re-apply must
keep the old plugin; atomic `apply` allows that, and neither Cordis nor
Harness promises it.

Serves: "Cordis-level plugin integration" (config, re-apply) and "Sidebar
agent config as fields on the agent's extension node":
`ClaudeRuntimeOptions` in `extension/agent-claude/src/claude.ts` (`executable`,
model) become slots of `sys.extension.agent`. Do not copy Harness's
`update/replace/mutate`; the outline already edits fields, with history.

### 2. A graph-driven loader: the extension node as the entry (S to M, after 1)

Cordis: the entry list is the program; entries carry `disabled`, `config`,
nesting. kb did the hard half: the switch is a node and one convergence
(`syncPlugins`) serves the page and `kb ui`.

In kb terms: widen "switch" to "entry". Give the repo extensions in
`.kb/extensions/` (today a file scan) nodes of the same kind, so enabling,
disabling and configuring any plugin is one gesture on one kind of node. Order
is sibling rank; nesting is a ref to a parent extension node, matching
`ctx.plugin(child)`. `BUNDLED_FAMILIES` stays the list of code that exists;
the nodes say what is on. Serves: "a graph-driven loader".

### 3. Lifecycle events, or delete the event seam (S)

`ctx.on` and `ctx.emit` are tested and unused. AGENTS.md Rule 1: "a dead seam
is still a duplicate. Wire it or delete it."

In kb terms: kernel-owned `Event` keys `plugin.loaded`, `plugin.unloaded`,
`plugin.failed`, `plugin.configured`, emitted by `activate`, `deactivate` and
`reconfigure`. First consumer: gap 4 (a view that updates without polling
`kernel.plugins()`) and the `kb ui` report. With no consumer in the same
change, delete `on` and `emit` and say so in DESIGN.md. Add no other dispatch
mode until a caller needs one. Serves: "lifecycle events".

### 4. A plugin view over the kernel (S to M)

Harness ships a Plugins page; Cordis exposes `getEffects()` and fiber state.

In kb terms: a read-only projection, a view like any other. Rows are extension
nodes (gap 2) joined at read time to `kernel.plugins()` for status, `missing`
and `error`, plus what each plugin provides, injects and contributes to which
points. That suits a graph tool: plugin-to-key relationships are edges, so
"who provides `ui.host`" or "who contributes to `kb.views`" is a query.
Derive them when read; never store a mirror. Needs two small kernel additions:
per-plugin `provides` and `contributions` listings, and an optional label on
registrations (Cordis's effect label). `ExtensionCatalog` rows carry
`{name, label, optional, enabled, source}` (DESIGN.md); status and error
belong in that row so the page and CLI report one thing. Home: a view type of
the extension family, built after outline and graph are families, as the first
non-trivial test of "a view is a plugin contribution". Serves: "a plugin view".

### 5. Optional injects: name the pattern, add no API (S, docs)

Cordis has no optional inject either; its way is `ctx.inject(deps, callback)`,
a child that appears and disappears with the service. kb's `ctx.plugin(child)`
with `inject` already does so (`loadEntry`, parent-scope finalizer). It needs a
paragraph in DESIGN.md and one contract test. An optional `get` would be a
second way to depend. Serves: the optional-injects half of the item.

### 6. Kernel contract suite (S)

Harness: "one role alone is not a seam". `extensionContract` proves a family
loads and unloads, but the kernel's own promises (atomic apply, pending on
provider loss, a failed re-apply keeps the old plugin) are tested in one
package only. State them once as a suite run over the server and page kernels
(AGENTS.md "One contract, every implementation"). Protects gaps 1 and 3.

### 7. Hot reload of repo extensions (M, lowest value)

Cordis HMR replaces stale plugins from the module graph; Harness queues it
with config reloads. kb has `syncPlugins` for unload and load; missing is a
cache-busted re-import of a changed `.kb/extensions/*.ts` and a watcher in
`kb ui` (my estimate, not checked against Bun's module cache). It speeds the
loop for a few repo extensions; bundled families change with the build. Do
last. Serves: "hot reload".

## Non-adoptions

- **Profiles, bundles, patch layers.** Harness layers YAML files owned by
  different parties. kb's config is nodes merged by id (`mergeNodeSets`); a
  layer stack would mirror the store. If named compositions are needed (CLI,
  MCP and `kb ui` differ), model one as a node that refs extension nodes.
- **`!!js` expressions in config and `disabled`.** Code stored as data; kb's
  stance is the opposite (`docs/kb/waves/2026-09-23/reports/carbon-extensibility.md`).
- **Plugin Manager, market, `engines.dsh` admission.** They serve
  npm-distributed third-party plugins; kb's extensions are repo-local and
  trusted. Revisit only if extensions become installable.
- **Vendoring Cordis.** kb's kernel is about 635 lines in Effect, with atomic
  apply and typed keys; Harness vendors to patch lifecycle gaps kb's kernel
  lacks (vendor items 6, 12, 20). Cordis would add a second runtime model
  beside Effect.
- **`ctx.isolate`, `ctx.intercept`.** One provider per key is a deliberate
  guard (`service-conflict`); several instances are keyed contributions to a
  point.
- **Slot cardinality and scope, `dsh.client` boot graph.** The page is already
  one kernel driven by the manifest, and "the default" is data
  (`sys.f.view.default`); a code taxonomy would duplicate it.
- **Per-agent scope and shadowing.** Adopt when a kb agent needs its own tool
  or prompt set; I did not look for that need.
- **Other dispatch modes, `timer`, `logger-console`, `cordisInspect`.** No
  caller; Effect's `Schedule`, logger and `Scope` cover the first three;
  `kb_manifest`, `graph_query` and the plugin view cover the last.

## Order

Decide gap 3 (wire or delete), then 1, 2, 4, with 6 beside 1. Gap 5 is a doc
change at any time; gap 7 last. Per Rule 1, each is a restructure commit first
(a `reconfigure` entry point, labels, per-plugin listings; behaviour
unchanged), then the behaviour.
