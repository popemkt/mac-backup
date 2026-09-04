# r1-effect-plan — Effect adoption audit and plan

Wave: 2026-08-24. Research only (no source / config / dependency changes).
Harness: cursor. Protocol: `briefs/impl-protocol.md` (gate + handoff; verification N/A).

## Recommendation (read this first)

**Hold the current boundary and formalise it. Do not complete “Effect everywhere.” Do not retreat.**

| Number | Fact |
| --- | --- |
| 24 / 57 | Backend `tools/kb/src/**/*.ts` files import `effect` / `@effect` (~42%) |
| 0 / 206 | UI `tools/kb/ui/src` files import Effect |
| 32 | `Effect.runPromise` / `runPromiseExit` / `runFork` call sites under `src/` (no `runSync`) |
| 3 | Live services today: `FileSystem`, `KbStore`, `KbCtx` |
| 0 | `Clock` / `Random` / id owners — wall clock and `ulid` remain ambient |
| `4.0.0-beta.106` | Exact pins on `effect` and `@effect/platform-bun` (no caret; one pin commit in history) |

Effect is already **load-bearing** on the write path (JSONL load/commit, `persistEffect` / `reloadEffect`, native action `effect` handlers, CLI/MCP/UI composition). The typed error channel is **real for domain I/O** (`DomainError`), and **intentionally collapsed to `never` at surface edges** (HTTP/MCP receipts). What is *not* load-bearing is the missing 58%: most of it is correctly pure, and the rest is a thin Promise / `node:fs` skin that exists for tests, bins, and Bun host APIs.

Finishing “the rest” as a purity crusade would spend waves on consistency without buying DST, typed errors, or interruptibility. The waves worth buying are: **(0) t2’s Clock/Random seam**, then **(1) naming and guarding the leaf boundary**, then optionally **(2) folding the few remaining effectful I/O modules that still call `node:fs/promises`**. Stop before pure core and before the React UI.

**Strongest arguments against this pick**

1. **Dual skin stays forever.** Promise facades (`openKb`, `invoke`, `JsonlStore.load`, `runWithKb`, operation wrappers) mean a future author can still discharge mid-graph by calling the wrong export. Formalising the boundary reduces that risk; only deleting the facades eliminates it.
2. **DST wants one Effect runtime.** If t2’s threaded-parameter list is long, “hold” leaves two determinism stories (Effect `TestClock` in Effect code, explicit params in non-Effect code). Completing Effect on every effectful module would collapse that — at the cost of a larger migration than the owner asked to plan blindly.

---

## Part 1 — audit

### 1. Boundary or frontier?

**Verdict: mostly a designed leaf boundary, with a parallel Promise skin that makes it a frontier if misused.**

DESIGN.md already states the intended shape (`tools/kb/DESIGN.md` ~360–374): Commander / MCP SDK / `Bun.serve` call `runPromise` / `runPromiseExit` at the process edge; action handlers stay inside Effect; third-party Promise `handler`s are the only `tryPromise` lift inside `invokeEffect`.

#### `run*` inventory (all under `tools/kb/src/`)

| Site | Kind | Classification |
| --- | --- | --- |
| `surface/cli.ts:114` (`withCtx`) | `runPromise` | **Leaf** — Commander action boundary |
| `surface/cli.ts:312`, `:346` | `runPromise` | **Leaf** — `mcp` / `ui` root resolve before host starts |
| `surface/cli.ts:846` | `runPromise` | **Leaf** — `ext sdk` |
| `surface/mcp.ts:220`, `:223` | `runPromiseExit` / `runPromise` | **Leaf** — resource handler → JSON-RPC / interrupt reject |
| `surface/mcp.ts:233`, `:327`, `:353` | `runPromise` | **Leaf** — server open, CallTool, start root |
| `surface/ui/server.ts:87`, `:171`, `:195` | `runPromise` | **Leaf** — UI start / scope finalizer / stop |
| `surface/ui/server.ts:104`, `:156`, `:163`, `:166` | `runFork` | **Event-leaf** — `fs.watch` / WS callbacks enter Effect; not mid-composition |
| `surface/ui/http.ts:164` | `runPromise` | **Leaf** — `Bun.serve` `fetch` → Promise `Response` |
| `surface/ui/assets.ts:128`, `:179` | `runPromise` | **Compat facade** — Promise skin over Effect; safe only if callers are non-Effect |
| `surface/ui/saved-queries.ts:39` | `runPromise` | **Compat facade** |
| `operations/docs/views.ts:138` | `runPromise` | **Compat facade** (`loadViews`) |
| `registry.ts:359` | `runPromiseExit` | **Compat leaf** — `invoke()` for bins/tests |
| `foundation/services.ts:167` | `runPromise` | **Compat adapter** — `runWithKb` |
| `context.ts:29`, `:35`, `:47` | `runPromise` | **Compat facade** — `openKb` / `reload` / `persist` |
| `foundation/storage/jsonl-store.ts:145`, `:151`, `:162`, `:166` | `runPromise` | **Compat facade** — `Store` Promise API / `asPromiseStore` |

No `Effect.runSync` in `src/`.

**Production Effect paths do the right thing:** `/api/action` uses `invokeReceiptEffect` inside `handleHttpRequestEffect` (`http.ts:114–117`), not nested `invoke()`. MCP `callToolEffect` provides `kbRuntimeLayer` and yields `invokeReceiptEffect` (`mcp.ts:172–179`). CLI `withCtx` opens and provides layers once (`cli.ts:114–124`).

**Frontier risk:** any Effect program that calls `invoke`, `openKb`, `store.load()`, or an operation’s Promise wrapper re-enters `runPromise` mid-graph. That pattern is for tests/bins (`bin/docs-*.ts`) today; it is not structurally impossible. The boundary is coherent *by convention*, not by type.

### 2. Typed error channel, or fancy Promise?

**Verdict: domain path is typed; surface edges intentionally erase; several spots still launder.**

**Real typed Failures**

- `DomainError` is `Schema.TaggedError` (`foundation/errors.ts:10–22`) with receipt-aligned codes.
- `JsonlStore.loadEffect` / `commitEffect` map FS and parse failures to `DomainError` (`jsonl-store.ts:17–26`, `:47–57`, `:91–96`).
- Operations use `Effect.fn` returning `DomainError` (`operations/index.ts` e.g. `nodeAddEffect`).
- `syncDomain` lifts throw-based resolve into `DomainError` (`operations/index.ts:36–46`) — honest bridge from pre-Effect helpers.
- `invokeEffect` keeps `ActionSchemaError | DomainError | Error` until `invokeReceiptEffect` maps to receipts (`registry.ts:292–348`).

**Intentional `never` at edges (not “fancy Promise” — policy)**

- `handleHttpRequestEffect`: `Effect<…, never, FileSystem | KbStore | KbCtx>` — `catchCause` → HTTP 500 (`http.ts:76–153`).
- `callToolEffect` / `containToolResult`: Fail/Die → MCP `isError` tool result (`mcp.ts:98–114`, `:132–137`).

**Laundering / weaker typing (cost without full benefit)**

- `Effect.orDie` on static/saved-query FS probes (`assets.ts:145`, `:159`; `saved-queries.ts:13–14`) — platform errors become defects.
- Plain `Error` subclasses still in the Fail channel: `RootNotFoundError`, `DocsError`, `UsageError`, `ActionSchemaError`, `ResolveError` (mapped at edges).
- `SubscriptionHub.handleMessage` uses internal `try/catch` and returns `Effect.Effect<void>` (default empty error) rather than typed Fail (`session.ts:131–180`) — Effect is used as structured async, not as an error algebra.
- Extension / registry discovery still `Effect.tryPromise` around dynamic `import()` (`registry.ts:303–307`) — correct for an external boundary, but the error is a plain `Error`.

**Bottom line:** the 42% is **not** cost-without-benefit on the store and native-action path. It **is** partly ceremonial at the hub / static-asset edge, where `orDie` and `never` erase the channel Effect is prized for.

### 3. Services / layers vs ambient state

**Present and used**

| Service / layer | Where | Role |
| --- | --- | --- |
| `FileSystem` via `bunFileSystemLayer` | `foundation/platform.ts:5–6` | Bun-backed FS for Effect I/O |
| `KbStore` | `foundation/services.ts:69–71` | Effect port over `EffectStore` |
| `KbCtx` | `services.ts:74` | Live mutable session in Context |
| `kbRuntimeLayer` | `services.ts:90–97` | Merge of the three for invoke tips |

**Ambient / dual**

- **`KbContext` is a mutable singleton-shaped session** passed by reference and also installed as `KbCtx`. `reloadEffect` / `persistEffect` / `SubscriptionHub.applyNodes` mutate `ctx.nodes` / `ctx.qdb` in place (`services.ts:127–159`; `session.ts:168–170`). That is ambient shared state for DST: wall-clock and identity are not the only nondeterminism sources — session mutation order is too.
- **Store duality:** `effectStore` + Promise `store` via `asPromiseStore` (`services.ts:122`; `jsonl-store.ts:157–169`). Same `JsonlStore` instance, two APIs.
- **`FileSystem` is not universal.** Effect paths use it for JSONL read and most asset/static probes. Still direct:
  - `node:fs` sync: `durable-replace.ts`, `write-lock.ts` (lock create/steal needs `openSync("wx")`-style atomics)
  - `node:fs/promises`: `saved-query.ts`, `extensions.ts`, `ext-sdk/emit.ts`, `surface/ui/build.ts`
  - `node:fs.watch`: `server.ts:1`, `:117–134`
  - `Bun.file` at HTTP response bodies: `assets.ts:116`, `:162`, `:173` (documented as Bun.serve boundary — good)
- **No `Clock` / `Random` service.** Call sites that matter for t2 (verified, not re-derived exhaustively beyond brief):
  - `nowIso()` → `new Date().toISOString()` — `foundation/model.ts:168–170`, used from operations / seed
  - `ulid()` — `operations/index.ts:339`, `operations/assets.ts:190`
  - `Date.now()` — write-lock spin timeout (`write-lock.ts:102`, `:117`, `:150`, `:153`); durable-replace tmp name (`durable-replace.ts:70`)
  - `crypto.randomUUID()` — WS client id (`server.ts:144`)
  - `Effect.sleep` in lock spin (`write-lock.ts:128`) — already on Effect’s clock *when* run under a TestClock-provided runtime; the `Date.now()` timeout beside it is not

**Implication for t2:** prefer Effect `Clock`/`Random`/`TestClock` inside Effect programs; for non-Effect sites, t2’s brief correctly says thread one explicit owner (default live) rather than invent a second capability record. That threaded-site list is phase-0 input below — **t2’s report has not landed in this worktree** (`docs/kb/waves/2026-08-24/reports/` empty at research time), so this plan treats t2 as phase 0 and does not duplicate its call-site census.

### 4. What the non-Effect 58% is

33 of 57 `src/**/*.ts` files do not import Effect. Categories:

**A. Correctly pure (must NOT move)**

- `foundation/order.ts`, `field-type.ts`, `model.ts` (types + `nowIso` helper — time *owner* moves, module stays sync), `ontology.ts`, `tx-validation.ts`, `canonical.ts`, `resolve.ts`, `seed.ts`, `example.ts`
- `foundation/query/*` (DataScript adapter; sync query over in-memory db)
- `surface/protocol.ts`, `format.ts`, `map.ts`, `ui/paths.ts`
- `operations/docs/templates.ts`
- `types/datascript.d.ts`, barrel/re-export files (`storage/index.ts`, `surface/ui.ts`, `index.ts` — `index.ts` re-exports layers but does not import Effect itself)

Moving these into Effect would add ceremony and fight t1’s property-testing targets (pure core is exactly where fast-check belongs).

**B. Genuinely effectful, still outside Effect**

| Module | I/O | Notes |
| --- | --- | --- |
| `foundation/saved-query.ts` | `node:fs/promises` | CRUD for `.kb/queries/*.edn` |
| `extensions.ts` | `readdir` + dynamic import | Loader; registry already `tryPromise`s discovery |
| `ext-sdk/emit.ts` | `mkdir` / `writeFile` | SDK write-out |
| `surface/ui/build.ts`, `dev.ts` | fs + process spawn | Build/dev host — Bun/Node tooling edge |
| `foundation/storage/durable-replace.ts` | sync `node:fs` | fsync/rename; called via `Effect.try` from `commitEffect` |
| `foundation/storage/write-lock.ts` (sync helpers) | sync `node:fs` | Effect acquire uses same primitives |
| `bin/docs-*.ts` | Promise facades | Tiny process edges |

**C. Schema dualism (related cost, not Effect-or-not)**

- Action schemas: **zod** (`operations/*`, `shared/contracts.ts`, `surface/protocol.ts`)
- Persistence node decode: **Effect Schema** (`node-schema.ts`)
- Seam documented in `schema-seam.ts` (Standard Schema v1) — intentional; wholesale zod→Effect Schema is a separate migration and should not ride this plan

### 5. The UI — should Effect enter?

**Recommendation: no.**

| For Effect in UI | Against |
| --- | --- |
| Typed async for WS reconnect / action queues | zustand + React 19 already own client state and lifecycle |
| One mental model with backend | Browser bundle: Effect + fiber runtime is real weight; UI has zero Effect today |
| | Server already owns Effect for `/api` and WS hub; client speaks JSON protocol (`surface/protocol.ts`) |
| | Solo-maintainer onboarding cost doubles (React idioms + Effect idioms) |
| | Rule 1: a second orchestration mechanism beside zustand is a parallel path |

**Boundary instead:** keep Effect on the **server** half of `kb ui` (`surface/ui/*`). Client stays React + zustand + plain `WebSocket` / `fetch`. If client async orchestration ever hurts, prefer a small typed client module (plain TS or a tiny queue) over pulling Effect into Vite.

---

## Part 2 — plan

### Target architecture (concrete)

```
Leaves (runPromise / runFork only here)
  CLI Commander actions  →  withCtx / one-off resolveRoot
  MCP SDK handlers       →  runResourceHandler / CallTool runPromise
  Bun.serve fetch + WS   →  handleHttpRequest / runFork(hub.*)
  bins + tests           →  Promise facades (shrinking over time)

Runtime (built once per session open)
  Layer.mergeAll(
    bunFileSystemLayer,          // exists
    kbStoreLayer(effectStore),   // exists
    kbCtxLayer(ctx),             // exists
    Clock.layer / live,          // t2 phase 0
    Random.layer / seeded,       // t2 phase 0
    // optional later: Id service if Random alone is insufficient for ULID shape
  )

Programs
  openKbEffect / reloadEffect / persistEffect
  invokeEffect / invokeReceiptEffect
  *Effect operations, render, docs, assets, hub methods

Must stay Promise / host
  Bun.serve, Bun.file bodies, node:fs.watch, durable-replace sync fsync,
  Commander argv, MCP SDK transport, third-party extension `handler`s
```

Do **not** add `@effect/cli`. Do **not** add a second Store abstraction. Do **not** invent a non-Effect `DeterministicClock` for production while Effect’s Clock exists (Rule 1 / t2 brief).

### Migration order (one wave each, independently shippable)

| Phase | What | Buys | Declinable? |
| --- | --- | --- | --- |
| **0 — t2 seam** | One owner each for time and identity; prefer Effect `Clock`/`Random`/`TestClock`; thread params at non-Effect sites; grep/oxlint bypass guard | Replayable DST; removes ambient `nowIso`/`ulid`/`Date.now` on mutation paths | **No** — parallel wave; this plan’s dependency |
| **1 — formalise boundary** | Doc the leaf table above in DESIGN (short); add a guard test that fails if `Effect.runPromise` appears inside `Effect.gen` bodies under `operations/` / `foundation/storage/` (or oxlint restricted syntax on those dirs). Delete or `@deprecated` Promise wrappers only where nothing external needs them | Makes the convention enforceable; stops frontier creep | Partially — doc-only is cheap; guard is the teeth |
| **2 — fold leftover effectful I/O** | `saved-query.ts` and extension directory listing → `FileSystem` Effects; keep dynamic `import()` behind one `tryPromise` | One FS story for query files / extension discovery; TestClock-friendly sleeps already exist on lock path | Yes if t2 threaded params already cover them |
| **3 — Promise skin diet** | Remove unused `runWithKb` operation wrappers / `loadViews` Promise / asset Promise facades once tests speak Effect | Consistency only | **Yes — label as consistency** |
| **Never** | Pure core → Effect; UI → Effect; zod schemas → Effect Schema wholesale; `@effect/cli`; second clock/id mechanism | — | Decline permanently |

### What must NOT move

- `foundation/order.ts`, `field-type.ts`, query/DataScript, `resolve.ts`, `tx-validation.ts`, `canonical.ts`, model types, protocol zod codecs
- React UI (`tools/kb/ui/**`)
- Sync durability primitives (`durable-replace.ts` sync fsync) — wrap with `Effect.try`, do not pretend `FileSystem` owns fsync semantics unless platform API proves equal
- Third-party extension Promise `handler` contract

### Interaction with `t2-dst`

- **t2 report: not landed** in this worktree at write time. Phase 0 **is** t2.
- This plan does **not** re-home time/id; it consumes t2’s threaded-site list as the backlog for “what remains outside Effect after phase 0.”
- After t2: Effect programs should read `Clock`/`Random`; remaining non-Effect call sites stay on the explicit owner t2 installs — one owner, two access styles until/unless phase 2 folds those modules.

### Interaction with `t1-property-mutation`

- t1 targets **pure** modules — aligned with “must NOT move.”
- Effect `TestClock` / deterministic runtime help **DST (t2)**, not property tests on order/field-type.
- Completing Effect adoption on pure core would **hurt** t1 (harder generators, worse counterexamples). Hold-and-formalise keeps that clean.

### Cost and risk

| Risk | Assessment |
| --- | --- |
| **Effect 4 beta API churn** | Pins are exact (`4.0.0-beta.106`). Git history shows **one** intentional pin commit (`6341fb0` — “Exact pins … so the CORE Effect migration can reconcile cleanly”); no subsequent beta bump in this repo’s kb history. **Guessing:** a bump will be a dedicated chore wave (type breaks in `Effect.fn` / Schema / platform-bun), not a drive-by. Plan must not assume stable 4.0 final. |
| **Bundle size if UI adopts Effect** | Avoided by recommendation. Backend already pays the dependency cost. |
| **Onboarding (solo repo)** | Layer/`Effect.gen`/`provide` is the steep part; already paid for 42%. Expanding into UI or pure core raises the floor for every future change. Holding the boundary caps the surface area a contributor must learn. |
| **Mutable `KbContext`** | Remains the hardest DST/concurrency seam after Clock/Random. Not solved by more Effect imports alone — needs discipline on who mutates session state (already concentrated in reload/persist/hub). Named gap if a later wave wants immutable snapshots. |

### Recommendation restated

**Hold and formalise.** Effect stays the backend orchestration and I/O algebra for store + actions + surfaces. Pure core and UI stay out. Phase 0 is t2. Phases 1–2 are the only follow-ons worth defaulting to “yes”; phase 3 is optional consistency.

---

## Handoff (protocol)

### What shipped (acceptance)

| Criterion | Status |
| --- | --- |
| Audit: boundary vs frontier with `run*` classification | Done — table above |
| Audit: typed errors vs fancy Promise | Done |
| Audit: services vs ambient | Done — `FileSystem`/`KbStore`/`KbCtx`; no Clock/Random; FS dualism named |
| Audit: non-Effect 58% categorised | Done — pure vs effectful leftovers |
| Audit: UI for/against | Done — recommend no |
| Plan: target architecture, phases, must-not-move | Done |
| Plan: t2 / t1 interaction | Done — t2 report absent; phase 0 = t2 |
| Plan: beta cost + recommendation + two counter-arguments | Done |
| Write only `reports/r1-effect-plan.md` | Done — no `tools/kb/src` / `ui/src` edits |

Verification four-command suite: **not applicable** (research-only brief).

### Cut

- Did not invent a call-site census for time/id (owned by t2; report not available).
- Did not propose zod→Effect Schema migration.
- Did not draft DESIGN.md patches (phase 1 work for an impl wave).

### Shared-file touches

None. Output path only: `docs/kb/waves/2026-08-24/reports/r1-effect-plan.md`.

### Red → green evidence

N/A — no guardrail, test, or lint rule was added (brief forbids code). Phase 1’s proposed bypass guard should be landed with deliberate red-then-green in that impl wave.

### Follow-ups

1. Orchestrator: merge/read **t2 report** when it lands; paste its threaded non-Effect sites into phase 0/2 backlog.
2. Impl wave for **phase 1** boundary guard (only after owner accepts hold-and-formalise).
3. Named gap: mutable `KbContext` as DST ambient state beyond Clock/Random.

### Self-grade

- **Solid:** `run*` classification, service inventory, pure-vs-effectful split, UI argument, beta pin history, explicit “do not duplicate t2.”
- **Gaps:** did not open every non-Effect file line-by-line (categorisation from imports + targeted I/O grep); WS `crypto.randomUUID` and lock `Date.now` listed but full nondeterminism census deferred to t2; Cognee recall unreachable this session (network).
- **Grade:** B+ as a decision memo for the owner; not an implementation spec for phase 2 file patches.
