# Report r6 — Extension public type surface (how external extensions use our types)

Wave: 2026-08-23 · Agent: opencode (r6) · Status: design research + impl spec, no code changes, no commits.

## 0. TL;DR

External `.kb/extensions/*.ts` authors have **no sanctioned type surface** today. The
only thing that works is a machine-specific absolute `import type` into the kb
checkout — which silently depends on Bun's **runtime auto-install** for transitive
deps, and is impossible under the packaged Nix layout (`$KB_PKG_ROOT` ships only
`cli.js` + `ui/dist`, no sources). **Chosen design:** the kb binary itself emits a
generated, self-describing ambient SDK — `kb ext sdk --write` → `<root>/.kb/sdk.d.ts`
— derived from src types by a build step and embedded in the CLI bundle, with a
freshness test asserting the committed copy matches regeneration. Types then always
match *the exact binary that loads the extension*, in both checkout and Nix layouts,
with zero installs.

---

## 1. Resolution findings (empirical; all verified in `/tmp/r6-lab` with bun 1.3.14)

### 1.1 Loader mechanics

- Discovery: `discoverExtensions(root)` reads `<root>/.kb/extensions/*.ts`
  (`.d.ts` excluded), sorts, and does `await import(pathToFileURL(path).href)`
  (`tools/kb/src/extensions.ts:128`). Default export must be an array of actions;
  per-file/per-action failures are collected, warned, skipped — never crash core.
- Bundled extensions (`extensions-bundled/docs.ts`, `canvas.ts`) are **statically
  imported by `src/registry.ts`** and registered first; they can use relative
  imports freely because they live inside the package.

### 1.2 What resolves at runtime for an external extension

| Specifier in `.kb/extensions/foo.ts` | Runtime result (verified) |
|---|---|
| relative sibling (`./helpers.ts`) | ✅ resolves against the extension file's own dir |
| bare specifier (`"zod"`) | ⚠️ conditional — see below |
| absolute path into kb src, `import type` | ✅ loads today (type-only erasure) — but not a contract |
| absolute path into kb src, value import | ⚠️ works only if that checkout exists on the machine AND its deps resolve; hard `ResolveMessage … Cannot find module` otherwise (loader skips file) |

Bare-specifier truth (the surprising part), per importing-file Node-style walk-up:

1. **No `node_modules` boundary anywhere up-chain from the extension file** → Bun
   *auto-installs* the package at import time into `~/.bun/install/cache`
   (verified: `zod@4.3.6` appeared there after loading an extension from a repo with
   no node_modules). Works, but means **network access + arbitrary versions at
   extension-load time** inside what looks like a local tool run.
2. **A `node_modules` dir exists up-chain but lacks the dep** → hard failure:
   `Cannot find package 'zod' from '…/.kb/extensions/e2-bare.ts'`.
3. **Dep present locally** → resolves locally, as expected.

This behavior is identical whether the loader runs from TS sources or from a
bun-bundled `cli.js` (`bun build --target=bun`; dynamic `import()` of non-analyzable
absolute paths stays dynamic). Verified both.

### 1.3 Why "import from `<repo>/tools/kb/src/…`" is not a contract

It *works today* on one specific machine shape — co-located dotfiles checkout — and
fails everywhere else:

- **Repo-relative fragility:** the absolute path embeds username/machine/checkout
  location. Verified failure when the path doesn't exist (`e8-other-machine.ts`,
  loader skip warning).
- **Transitive dep leakage:** tsc following an absolute import into kb src surfaces
  `Cannot find module 'zod' / 'effect'` in the *author's* program unless they install
  kb's deps too (verified in `/tmp/r6-lab/tsc-lab`).
- **Packaged Nix layout has no sources:** `pkgs/kb/default.nix` installs exactly
  `$out/lib/kb/cli.js` (bundle, deps inlined) + `$out/lib/kb/ui/dist`. Verified live:
  `/nix/store/…-kb-0.1.0/lib/kb/{cli.js,ui}`. There is nothing to import; option dies
  outright for the primary install of this repo.
- **Accidental success mode:** on this machine a *value* import from the checkout
  loaded even under the packaged binary — via checkout co-location plus Bun
  auto-installing `zod` mid-load. That is the opposite of a contract.

### 1.4 Type-only vs value imports (Q3)

- `import type` is fully erased by Bun's transpiler before execution: an extension
  whose *only* import is `import type {…} from "totally-not-a-real-package/contracts"`
  loads cleanly (verified, `e3-typeonly-bogus.ts`, incl. from bundled cli.js).
  So **any type-only specifier is runtime-safe**, whatever it points at.
- Values are different: helpers (`succeeded`, `failed`, zod itself) must resolve for
  real. The **sanctioned runtime value surface today is empty** — deliberately so:
  - `inputSchema`/`outputSchema` are duck-typed at the seam
    (`isActionSchema`: Standard Schema v1 `~standard` or any `{parse}` object,
    `src/foundation/schema-seam.ts`). A hand-rolled `{ parse(v){…} }` needs zero
    imports (verified loadable).
  - Promise handlers receive `(ctx: KbContext, input)`; receipts come back from the
    registry, so authors don't need `succeeded`/`failed`.

### 1.5 Adjacent ergonomics finding

Every `.ts` in `.kb/extensions/` is discovered as an extension (only `.d.ts` is
excluded). A shared-helper sibling must therefore default-export something array-like
(`export default []` is silently accepted: zero actions ⇒ not registered, no warning);
anything else produces "default export must be an array" noise on every start.
Worth documenting (and optionally honoring an `_`-prefix ignore rule later).

---

## 2. Options analysis (Q2)

Considerations that dominate: packaged Nix layout (no sources), repo checkout layout,
editor DX (completions/go-to-def), drift between shipped types and the *running*
binary, versioning.

| Option | Checkout layout | Nix layout | Editor DX | Drift risk | Notes |
|---|---|---|---|---|---|
| **(a)** package `exports` map on npm/linkable `kb` | ✅ | ❌ (nothing to link; binary is a bundle; would pin types to a *different* artifact than the nix binary) | ✅ full | npm version vs installed binary skew | Requires publishing; private:true today. Good future complement, wrong primary now. |
| **(b)** generated ambient `.d.ts` emitted next to `.kb/` by the binary itself | ✅ | ✅ (types embedded in cli.js, emitted on demand) | ✅ completions + errors via triple-slash or tsconfig include | Low — generation derives from src + freshness test; emitter travels with the binary | Self-describing install; no network, no installs. **Chosen.** |
| **(c)** triple-slash reference / tsconfig paths doc pointing at repo src | ✅ (machine-specific) | ❌ no src to point at | ⚠️ works but drags unresolved zod/effect into author tsconfig (verified) | High — encourages coupling to internal file layout | Keep the *mechanism* (reference/include) as the consumption story for (b); not sufficient alone. |
| **(d)** structural contract docs only (no imports) | ✅ | ✅ | ❌ no completions, no static errors; typos ship to runtime | Contract drift undetectable until runtime skip | Already partially true for schemas (Standard Schema v1 seam). Keep as documented fallback, not primary. |

**Decision: (b) as primary, consuming mechanics from (c), (d)'s schema seam stays the
no-dependency fallback, (a) deferred** until/unless kb is ever published as a package.

Rationale, compressed: the Nix package is this repo's actual consumption mode and it
has no sources; therefore the type source must travel *inside* the artifact that
loads extensions. Embedding the generated `.d.ts` text in the CLI bundle makes
`kb` self-describing: the types you get are byte-for-byte derived from, and stamped
with the version of, the binary that will execute your handler. No registry, no
network, no second version axis.

---

## 3. Chosen design

### 3.1 Surface

One committed barrel defines what the SDK exposes — types only:

```
tools/kb/src/ext-sdk/surface.ts
```

re-exporting from `src/index.ts` / owners:

- `ActionDefinition`, `ActionMode`, `ActionReceipt`, `FailureCode` (`shared/contracts.ts`)
- `ExtensionAction`, `ExtensionPromiseHandler`, `LoadedExtension`, `ExtensionFailure` (`src/extensions.ts`)
- `KbContext` (`foundation/services.ts`) — the Promise-handler ctx
- `ActionSchema` (+ `StandardSchemaV1Like`, `ParsableSchema`) (`foundation/schema-seam.ts`)
- `KbNode`, `NodeId`, `PropValue` (node model, for ctx.nodes consumers)

Policy: the `effect:` branch of `ExtensionAction` stays in the type (it is what the
runtime accepts) but docs steer external authors to Promise `handler`s; Effect v4 is
still beta and bundled extensions may churn ahead of the public seam.

### 3.2 Generation & embedding (single source of truth, Q4)

```
tools/kb/scripts/gen-ext-sdk.ts        # generator (build/dev-time)
tools/kb/src/ext-sdk/sdk-dts.text.ts   # GENERATED, committed: exports const KB_SDK_DTS: string
```

- Generator invokes `tsc` CLI (`--emitDeclarationOnly --declaration` over a synthetic
  entry `export * from "../src/ext-sdk/surface.ts"`), strips private/internal
  decls, wraps output in `declare module "kb-ext-sdk" { … }`, prepends a header:
  kb version, generation command, date, and "regenerate with `bun tools/kb/scripts/gen-ext-sdk.ts`".
- Output written to `sdk-dts.text.ts` as a template literal (committed, reviewable
  diffs — same philosophy as `docs/kb/*` materialization: data → generate → commit).
- Because `sdk-dts.text.ts` is ordinary TS, `bun build` of `src/surface/cli.ts`
  inlines it into `cli.js` automatically — the Nix FOD picks it up with **zero
  packaging changes**.
- CLI: new `kb ext sdk [--write]` subcommand — prints `KB_SDK_DTS` to stdout, or
  writes `<root>/.kb/sdk.d.ts` (creating dirs) with `--write`. Works identically from
  checkout or Nix install since the string lives in the bundle.

### 3.3 Freshness assertion (tests)

1. `tools/kb/tests/ext-sdk-fresh.test.ts`: regenerate the d.ts text in-memory via the
   same generator module and assert byte-equality with `KB_SDK_DTS`. Fails whenever
   src types changed without regenerating. Wired into existing `bun test`; optionally
   added to pre-commit alongside `docs.check`.
2. Belt-and-braces assignability test: compile a snippet importing both the real
   `ExtensionAction` and the SDK's, asserting mutual assignability — catches wrapper
   mistakes (wrong module name, lost generics) that regeneration alone wouldn't.
3. Loader-level test: `kb ext sdk --write` output placed in a temp root is picked up
   as a plain file by `discoverExtensions` (it ends `.d.ts` → ignored) and by tsc
   (smoke: `tsc --noEmit` over a fixture extension + the emitted file exits 0).

### 3.4 Consumption story for authors (mechanics verified in `/tmp/r6-lab/tsc-lab2`)

```ts
// .kb/extensions/greet.ts
/// <reference path="../sdk.d.ts" />
import type { ExtensionAction } from "kb-ext-sdk";

const actions: ExtensionAction[] = [ /* … */ ];
export default actions;
```

- `"kb-ext-sdk"` exists nowhere at runtime — irrelevant, the import is erased
  (§1.4); the name is just the ambient module key declared in the d.ts.
- Triple-slash reference makes it work even with **no tsconfig** (file-level);
  alternatively authors whose tsconfig already includes `.kb/**/*.d.ts` need neither
  the reference nor anything else (verified: both paths produce full checking —
  e.g. `mode: "reed"` → `Type '"reed"' is not assignable to type 'ActionMode'`).
- Values policy (documented): schemas may be zod (author-installed; recommend
  tracking kb's major, zod 4.x, so manifest JSON-Schema matches) or any Standard
  Schema v1 object, or a bare `{parse}` — no kb imports needed. Handlers are plain
  Promises over `(ctx, input)`. No other runtime values are sanctioned in v1;
  `succeeded`/`failed` remain internal (registry builds receipts).

### 3.5 Docs updates (impl checklist)

- `DESIGN.md` §Core boundary & extensions: add "Extension SDK" paragraph (emit,
  freshness test, author loop, helper-sibling convention `export default []`).
- `AGENTS.md` kb section: one line — "external extensions: run `kb ext sdk --write`,
  reference `.kb/sdk.d.ts`, `import type { ExtensionAction } from \"kb-ext-sdk\"`".
- `tools/kb/README.md`: short author quickstart with the greet example.

---

## 4. Author walkthrough

### Before (ground truth today)

1. Copy `extensions-bundled/docs.ts` into `.kb/extensions/greet.ts`; rewrite imports.
2. `import { KbCtx } from "<repo>/tools/kb/src/context.ts"` — resolves only on
   machines with that exact checkout; editor shows `Cannot find module` unless the
   path happens to exist; under the Nix-installed `kb` the path is meaningless.
3. Try bare `import { z } from "zod"` — either auto-installs a surprise version at
   load time (repo without node_modules) or fails hard (repo with node_modules
   lacking zod).
4. Give up on types: hand-write untyped action objects; a `mode: "reed"` typo sails
   through to runtime and the action is silently skipped with a console warning.

### After

```bash
$ kb ext sdk --write          # once per kb upgrade; types match THIS binary
wrote .kb/sdk.d.ts (kb 0.1.0)
```

1. Author `.kb/extensions/greet.ts` with the reference + `import type … from
   "kb-ext-sdk"` (snippet above).
2. Editor gives real completions (`id/title/description/mode/inputSchema/…`) and
   catches `mode: "reed"` statically.
3. `kb ext list` shows `greet` loaded; runtime behavior unchanged — no imports to
   resolve, no node_modules needed, identical under checkout and Nix installs.
4. On kb upgrade: rerun `kb ext sdk --write` (or read the header's version stamp in
   the diff); old extensions keep compiling unless a breaking type change says
   otherwise — which is now visible in the regenerated file diff.

---

## 5. Risks / follow-ups

- **TS7 declaration emit**: generator uses the `tsc` CLI, not compiler API, to stay
  insulated; if TS7 emit output shifts, the freshness test pins the format.
- **Helper siblings** discovery noise (§1.5): document the `export default []`
  convention now; consider ignoring `_*.ts` in `discoverExtensions` as a small
  follow-up (behavior change → own wave).
- **Option (a) complement**: if kb is ever published, add `exports: { "./ext-sdk":
  { "types": … } }` mapping to the same generated d.ts; the generator already owns
  the artifact, so this is additive.
- **Effect exposure**: revisit including `ActionEffectHandler` in the public surface
  when effect@4 stabilizes.

---

## Implementation handoff

Wave i4-backend · Agent: cursor-agent · Branch: `popemkt/kb-i4-backend` · Status: shipped (not pushed).

### What shipped

1. **Extension SDK (this report’s chosen design)**
   - `tools/kb/src/ext-sdk/surface.ts` — self-contained public types (no Effect/zod imports) so declaration emit stays portable under Nix and checkout layouts.
   - `tools/kb/scripts/gen-ext-sdk.ts` — `tsc --emitDeclarationOnly` over surface → ambient `declare module "kb-ext-sdk"`.
   - `tools/kb/src/ext-sdk/sdk-dts.text.ts` — GENERATED committed `KB_SDK_DTS` string (inlined into `cli.js` / Nix FOD with zero packaging changes).
   - `tools/kb/src/ext-sdk/emit.ts` — `writeSdkDts(root)` / `readEmbeddedSdkDts()`.
   - CLI: `kb ext sdk` (stdout) and `kb ext sdk --write` → `<root>/.kb/sdk.d.ts`.
   - Tests (`tests/ext-sdk-fresh.test.ts`): freshness byte-equality vs regeneration; CLI write + loader ignores `.d.ts`; scratch author fixture typechecks with zero repo-relative imports and loads at runtime; `mode: "reed"` fails tsc.
   - Docs: `tools/kb/DESIGN.md` Extension SDK paragraph; `tools/kb/README.md` author quickstart; `package.json` script `gen:ext-sdk`.

2. **Stage-0 JSONL hardening (r4 context, cheap/safe only — format unchanged)**
   - Exclusive `.kb/nodes.jsonl.lock` covering load → mutate → replace (`foundation/storage/write-lock.ts`); spin via `Effect.sleep` (never event-loop-blocking sleep).
   - Durable replace: write+fsync tmp, rotate `.bak` (+fsync), rename, best-effort dir fsync (`durable-replace.ts`).
   - HTTP/WS untouched; bundled `docs.ts` behavior unchanged.
   - Tests: concurrent commits retain all writers’ nodes; stale lock stolen.

### Judgment calls

- **Surface is self-contained, not a re-export barrel from live modules.** Re-exporting `extensions.ts` / `contracts.ts` would drag Effect/zod into the ambient d.ts and break the Nix/no-deps author story. Freshness + author tsc fixtures guard drift. Full Real↔Sdk mutual assignability of `ExtensionPromiseHandler` was not enforced: Sdk `KbContext` is the Promise-handler subset `{ root, nodes }`.
- **CLI `ext sdk` lives in `surface/cli.ts`.** Brief zone names “SDK emission step”; treated as in-zone.
- **Repo-root `AGENTS.md` one-liner deferred** (outside zone) — orchestrator/F docs pass.
- **Skipped:** SQLite migration, revision/CAS manifest, streaming load, `_*.ts` discovery ignore (follow-ups / later waves).
- **Replaced** Effect-FS rename mock atomicity test with lock concurrency + stale-lock coverage (write path is node:fs durable protocol).

### Shared-file / out-of-narrow-zone touches

| Path | Why |
|---|---|
| `tools/kb/src/surface/cli.ts` | `kb ext sdk [--write]` emission command |
| `tools/kb/DESIGN.md` | Extension SDK author contract (research MUST §3.5) |
| `tools/kb/README.md` | Author quickstart |
| `tools/kb/package.json` | `gen:ext-sdk` (in zone) |

### Cut / follow-ups

- AGENTS.md / CLAUDE.md one-liner for `kb ext sdk --write`.
- Optional: ignore `_*.ts` helper siblings in `discoverExtensions` (this report §1.5 / §5).
- Optional: pre-commit freshness check alongside `docs.check`.
- r4 remainder: revision/CAS, verified generation rotation, streaming load, SQLite stages.
- npm `exports` map for `kb-ext-sdk` if kb is ever published (option a).

### Verification

- `bun test` — 441 pass / 0 fail
- `npm run typecheck` — clean
- `npm run check` — clean
- `cd ui && vp test` — 47 files / 264 tests pass
- Manual `/tmp` scratch: `ext sdk --write`, tsc clean, extension loads and invokes

### Self-grade

**A-** against the quality bar. SDK matches this report’s design (self-describing binary, freshness gate, verified author walkthrough). Stage-0 durability/locking is real but not crash-injection complete (no power-loss / F_FULLFSYNC / revision CAS). Honest gap: Sdk `KbContext` is intentionally narrower than the live session; authors needing `store`/`qdb` still lack typed access without reaching into core.
