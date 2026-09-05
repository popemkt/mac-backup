# w3-operations-shared — the actions run anywhere

Wave `w3` of `docs/kb/waves/2026-09-06/plan.md`. Harness: claude (opus, high).
Branch from `main` **after w1 is merged** (the coordinator gives you the base).
Runs beside `w4` (claude; server hub, tx log, UI live path). You own:
`tools/kb/packages/application/operations/**` (except the log-append lines w4
adds to `session.ts` `persistEffect` — you replace the stat stamp there; the
coordinator merges the hunk), `tools/kb/packages/contract/contracts/src/**`
except `protocol.ts` and any new `tx-log.ts` (w4's), a **new**
`tools/kb/packages/infrastructure/workspace-fs/**`,
`tools/kb/packages/infrastructure/store-jsonl/src/**` (fingerprint),
`tools/kb/packages/contract/ext-sdk/**`, `tools/kb/packages/app/runtime/**`
(loader move, layers), `tools/kb/packages/app/{server,cli,mcp}/src/**` where
they import moved symbols (mechanical), `tools/kb/harness/src/constraints.ts`
+ a new `tools/kb/tsconfig.iso.json` + harness tests, `tools/kb/AGENTS.md`
"Shape" bullets that describe scopes, and your report.

Read first: the operations recon in the coordinator's notes is summarised
here — verify each claim against the tree: `operations/src/{saved-query,extension-loader,assets,session,actions,render}.ts`,
`operations/src/docs/{views,docs}.ts`; `contracts/src/{store,session,actions}.ts`;
`runtime/src/{layers,registry}.ts`; `harness/src/constraints.ts`
(`SCOPE_ALLOWS`, `RUNTIME_ONLY_SPECIFIERS`, `RUNTIME_PRESET_BY_SCOPE`);
`AGENTS.md` Rule 1; `tools/kb/AGENTS.md` incl. Effect;
`tools/kb/node_modules/effect/AGENTS.md`. Run `intent/gate.sh session claude-code` first.

## The facts (verify, then act)

- The only cross-scope workspace edge is `operations → @kb/ext-sdk`
  (`extension-loader.ts`); `ext-sdk` is backend only because of `emit.ts`
  (`node:path`).
- Five `node:*` import sites in four files: `saved-query.ts` (path),
  `extension-loader.ts` (path, url), `assets.ts` (path), `docs/views.ts`
  (path). `Buffer.from` in `assets.ts:115` is a hole the fence cannot see
  because the shared preset types Bun.
- `effect/FileSystem` is legal under the fence but a browser has none; it
  appears in `saved-query`, `extension-loader`, `assets`, `docs/views`,
  `docs/docs`, `actions` (only `graphRunEffect`), `session` (only the stat
  stamp), `render` (type).
- Four actions are isomorphic today (`node.get`, `graph.query`,
  `graph.search`, `ontology.members`); six need exactly one port; one
  (`asset.upload`) writes bytes; extension discovery is server-only wholesale.
- Time and ids already come from `Clock`/`Random` via `@kb/model`; the
  determinism harness proves operations is clean.

## Commit 1 — `feat(kb): EffectStore.fingerprint; the session forgets the filesystem`

`EffectStore` gains `readonly fingerprint: Effect<StoreFingerprint | null, never>`
(`{ size, mtimeMs }` for JSONL today; the type is opaque to callers). The
`stamps` WeakMap, `stampOf`, `same`, `noteStoreSynced` in `operations/src/session.ts`
collapse to comparing fingerprints; `session.ts` imports no `FileSystem`.
`JsonlStore` implements it. The p1b gap on same-tick writes stays open (a
fingerprint is still a stat) — update its `current`. Behaviour-preserving;
`index-rebuilds.test.ts` stays green.

## Commit 2 — `feat(kb): SavedQueries, Views, Assets ports; workspace-fs adapter`

`contracts/src/workspace.ts`: three `Context.Service` ports.
`SavedQueries { list; read(name); write(name, edn); remove(name) }`,
`Views { list; load(name) }`, `Assets { write(id, ext, bytes: Uint8Array) → relPath }`.
Path resolution and traversal defence live in the adapter, not the port; the
pure name validator (`isValidSavedQueryName`) stays in operations. New
package `packages/infrastructure/workspace-fs` (`scope:backend`) carries the
filesystem halves of `saved-query.ts`, `docs/views.ts`, `assets.ts` and
provides the three Layers over `FileSystem`. Operations consumes the ports:
`graphRunEffect`, `render.view(s)`, `docs.ts`, `asset.upload` (its base64
decode via `Uint8Array.fromBase64` or `atob`, not `Buffer`). `runtime/src/layers.ts`
provides the adapter Layers; `server/src/saved-queries.ts` and
`server/src/assets.ts` consume the ports instead of the moved functions.

## Commit 3 — `refactor(kb): extension discovery is the runtime's`

`operations/src/extension-loader.ts` → `runtime/src/extension-loader.ts`
(its one production consumer is `registry.ts`). `operations/package.json`
drops `@kb/ext-sdk`. If `ext-sdk/src/emit.ts` is the only reason `ext-sdk` is
backend, move `emit.ts`'s consumer (`scripts/generate.ts`) to import it by
path and retag `ext-sdk` shared; otherwise leave `ext-sdk` and say why.

## Commit 4 — `feat(kb): operations is scope:shared; the shared preset has no Bun`

- `operations/package.json` `nx.tags` → `scope:shared`. `bun run harness`
  proves the fence: no `node:`/`bun:`/`platform-bun` import, no
  backend workspace edge.
- `tools/kb/tsconfig.iso.json`: extends the base, `types: []` (or DOM-free
  ES lib only), no Bun. `RUNTIME_PRESET_BY_SCOPE.shared` points at it; every
  `scope:shared` package's `tsconfig.json` extends it; `bun run typecheck`
  green — anything that fails is a real leak (fix it, list it).
  `tsconfig-contract.test.ts` red case: a shared package on the Bun preset.
- `tools/kb/AGENTS.md`: one sentence on the three presets.

## Do not

- Touch `server/src/session.ts` (hub), `server/src/server.ts`,
  `contracts/src/protocol.ts`, `packages/app/ui/**` — w4/w5.
- Add `run(ir)` callers or change query semantics.
- Build a browser store or runtime layer — w5.

## Acceptance

`bun run verify`, `bun test packages`, `bun run test:ui` green. Harness
boundaries green with operations shared. `grep -rn "node:\|Buffer\." tools/kb/packages/application`
empty. `grep -rn "FileSystem" tools/kb/packages/application/operations/src`
empty. `index-rebuilds.test.ts` green. Report:
`docs/kb/waves/2026-09-06/reports/w3-operations-shared.md` — the action
inventory after (isomorphic / port-backed / server-only), every moved symbol,
what the iso preset caught, and what w5 needs to build a browser `KbContext`.
