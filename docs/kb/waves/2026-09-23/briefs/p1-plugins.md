# p1-plugins — one plugin kernel under every extension

Wave `p1` of `docs/kb/waves/2026-09-23/plan.md`.

## Why

An extension today (`contracts/src/extension.ts`) is a default-exported array
of actions and render templates, registered by a hand-rolled loop in
`runtime/src/registry.ts`. Three limits follow:

- **No UI.** Nothing in the browser discovers extensions. Canvas is an
  extension only by its one action; its tag and field are seeded by core and
  its ~37 UI modules are hardwired into `App.tsx`, `router.ts`, the sidebar,
  `bullet-mode.ts` and `canvas-api.ts` (`"ext.canvas.tx.apply"` as a string).
- **No composition.** An extension cannot offer something to another one or
  depend on it; there is no event, no service, no child.
- **No lifecycle.** Registration is a build-once cache per root; there is no
  unload, so no reload, and a registration cannot clean up after itself.

## Prior art (surveyed 2026-09-23)

- **DeepSeek Harness** (MIT, preview 2026-08-13): "everything is a plugin" on
  Cordis. A plugin is an npm package; `package.json` `dsh.client` plus
  `exports["./client"]` adds a browser half. Plugins `inject` services by
  name, `ctx.effect` scopes every side effect, the browser runs its own Cordis
  and registers into typed slots (`ctx.slots.register`, cardinality
  single/list/keyed/chain, keys by declaration merging).
- **OpenCode**: `"."` server plugin, `"./tui"` UI plugin in one package.
- **VS Code / Grafana**: contribution points the host can list without
  running code. **Backstage**: extension points and inputs by id.
- **MCP Apps / Figma / Logseq**: sandboxed iframes over a message protocol —
  right for untrusted code, wrong for a canvas that must share React and the
  DOM with the outliner. Kept as a later transport, not a second system.

## The kernel (`@kb/plugin`, `packages/domain/plugin`, `scope:shared`)

Effect-native, no kb dependency, so the server, the CLI, MCP and the browser
run the same one.

- **Keys** are typed names: `Service<S>()(name)`, `Event<P>()(name)`,
  `Point<C>()(name)`. The phantom type is the whole contract; nothing at
  runtime but the name.
- **A plugin** is `{ name, namespace?, inject?, apply(ctx, config) }`, with
  `apply` an `Effect<void, PluginError, Scope>`.
- **`ctx`** is the plugin's handle on the kernel, and every method that
  registers something registers it in the plugin's scope:
  - `provide(key, impl)` — at most one provider per key.
  - `get(key)` — only keys the plugin declared in `inject`.
  - `contribute(point, { id, aliases?, ...value })` — ids are namespaced by
    the plugin (`<namespace>.<id>`), keys and aliases unique per point.
  - `on(event, handler)` / `emit(event, payload)` — handler failures are
    reported, never propagated to the emitter.
  - `plugin(child, config)` — a child unloads with its parent.
- **Lifecycle.** `load` activates a plugin whose injected services all exist,
  or leaves it `pending` until they do. Unload closes its scope: its services,
  contributions, listeners and children go, and every plugin that injected
  one of its services returns to `pending` (and reactivates if a provider
  comes back). A failing `apply` leaves nothing behind — the scope closes on
  the failure — and the plugin is `failed` with the error; the kernel never
  crashes.
- **Reads** are synchronous (`contributions(point)`, `lookup(point, id)`,
  `plugins()`), plus `subscribe(listener)`, so React can read the registry
  through `useSyncExternalStore` without running an Effect per render.

## Phase 2 — the backend registry is the kernel

- Core actions are a plugin with the root namespace; bundled extensions are
  plugins with namespace `ext.<name>`; each `.kb/extensions/<file>.ts` is one
  too. `ActionPoint` and `TemplatePoint` live in `@kb/contracts`.
- A default-exported array is the declarative form of a plugin: the loader
  bridges it to a plugin whose `apply` contributes each entry. An Effect
  plugin (`definePlugin`) is the full form. One mechanism either way.
- Clash behaviour changes in one respect, deliberately: a plugin that clashes
  fails as a unit (its scope closes) instead of registering around the
  clashing entry — a half-registered extension is a state nothing asked for.
- The manifest, invoke and templates read the kernel's points.

## Not in p1

- A Promise-flavoured `ctx` for third-party authors who do not write Effect —
  the array form covers them until then.
- Sandboxed (iframe / MCP Apps) transport for untrusted UI.
- Fail-closed admission for repository extensions — gap
  `01M1PJVJX84AZCRVJ82R20WTK3`, unchanged.
