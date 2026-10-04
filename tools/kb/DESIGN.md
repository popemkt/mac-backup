# `kb` — repo-native outliner datastore (design doc)

A Bun/TS tool living in this repo that persists an outliner graph as
git-friendly JSONL, exposes a datalog query layer (DataScript), and
materializes markdown from queries. One action registry drives CLI and MCP.

**What this actually is** (answering the "graph db?" question): yes — a tiny
graph database plus application features, which is exactly Tana's and Logseq's
architecture. Logseq _is_ DataScript in memory (classic parses md → datoms; the
new DB version persists datoms in SQLite). Tana is a proprietary node graph
with supertags/fields/views as app features on top. We build the same shape,
minimal: DataScript = graph engine; our node/field/tag model = app layer.
Reactivity (TanstackDB-style live queries) is how Logseq's UI works —
`d/listen!` on transactions → re-run affected queries. Irrelevant for a
per-invocation CLI (fresh db each run); if we later add watch-mode or a server,
`d.listen` is the hook. Door left open, nothing built.

## Decisions

| Decision  | Choice                                              | Why                                                                                                                                                       |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name      | **`kb`**                                            | confirmed                                                                                                                                                 |
| Storage   | Backend-agnostic `Store`; **JSONL backend v1**      | exact round-trip, line-per-node git diffs. git-lfs rejected (stores blobs, doesn't make them mergeable); dolt-on-branch possible later as another backend |
| Query     | **DataScript** in-memory, rebuilt per invocation    | real datalog; Cozo persistent backends are binary                                                                                                         |
| Surfaces  | **CLI + MCP over one action registry**              | action is the abstraction (harman pattern)                                                                                                                |
| Runtime   | **Bun**, no build step                              | the production `kb` tool (CLI, `kb ui` server, MCP) runs under Bun and may use Bun APIs (`Bun.serve`, `Bun.file`, …) where appropriate                    |
| Toolchain | **TypeScript 7 + Vite+ (`vp` 0.2.8)**               | vp owns lint/check/fmt/UI test; authoritative typecheck is `tsc --noEmit` — see [Runtime/tooling boundary](#runtimetooling-boundary)                      |
| Model     | **Everything is a node** — fields and tags included | Tana model; Logseq DB does the same (properties are first-class entities)                                                                                 |

## Workspace shape

`tools/kb` is a **Bun workspace**. Every concept is a package under
`packages/<layer>/<name>`, named `@kb/<name>`, private, `version 0.0.0`,
publishing one curated barrel of named exports at `src/index.ts` (or
`"exports": {}` when it has no importable surface). It has two axes, and each
axis is stated in exactly one place:

| Axis      | Where it lives                    | Values                                                                                    | Means                               |
| --------- | --------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------- |
| layer     | the folder under `packages/`      | `domain`, `contract`, `infrastructure`, `application`, `app`, `extension`, `test-support` | which way dependencies may point    |
| `scope:*` | one tag in the package's `nx` key | `shared`, `backend`, `browser`, `test-support`                                            | which runtime the code must survive |

Placement carries the layer because the layer is the thing a reader wants to
see without opening a manifest, and a `layer:*` tag beside the folder would be
a second copy free to disagree with it. Scope stays a tag: which runtime the
code must survive is orthogonal to where the code sits, and one package's
answer does not group it with its neighbours. `packages/`'s subdirectories are
exactly the `LAYER_ALLOWS` keys — `workspace-shape` fails on a folder that is
not one, and on any manifest that still declares `layer:*`.

```
packages/
  domain/          model  plugin  query
  contract/        contracts  ext-sdk
  infrastructure/  store-jsonl  store-sqlite  tx-log  workspace-fs
  application/     operations
  extension/       canvas  ext-canvas  ext-check  ext-docs
  app/             client  runtime  server  cli  mcp  webmcp  ui  test-kit
  test-support/    render-tests
```

The direction rules live in exactly one place, `harness/src/constraints.ts`,
and the harness applies them to what the code imports. There is no alias map:
`@kb/*` resolve as workspace packages through each package's `exports`, and a
package name never encodes its layer — moving a package between folders is a
`git mv` plus one `extends` path.

An extension's parts are separate workspace packages by runtime, colocated
under `extension/`: `@kb/canvas` owns the shared JSON Canvas document and
`@kb/ext-canvas` owns its backend plugin. The browser part still lives in
`@kb/ui` pending the `@kb/ui-sdk` host contract (gap
`01M39F3MR3HT2NR553FY8CRD6X`); it must not be extracted as a second UI
mechanism ahead of that contract. A package has one `scope:*` tag, never a
per-entry scope. Extension packages can import another extension package's
public barrel when their scope permits it. Third-party `.kb/extensions` use
the generated ambient `kb-ext-sdk` declaration, not workspace package imports.
The layer and scope matrices admit only directions used by package imports;
an empty compatibility edge is not a contract. `app` is the composition
root, while `test-support` reaches only the domain and app surfaces its
render harness actually drives. The UI's intra-package matrix is a separate
zone contract; unused zone edges await the R1 view-point work rather than
changing the surface imports under that branch.

Nothing in the harness reads the Nx project graph. It supplied the tags, and
its dependency edges were measured to be manifest-derived only; the workspace
reader answers both questions without spawning `nx graph`. Nx remains the task
runner (`nx run-many -t typecheck`, `nx affected`).

The harness is **not** one of these packages. It checks the workspace's shape,
so it lives at `tools/kb/harness` — root tooling, outside `packages/`, typed by
the root `@types/bun`, typechecked by the root Nx project `kb-workspace`, and
named in the `lint` and `fmt` scopes. That is why neither axis carries a
`tooling` row: the harness was the only thing that would have held one, and a
row that exists so the checker can be a member is a special case, not a
constraint. `boundaries` asserts the reverse — no file under `harness/` imports
`@kb/*` or resolves out of `harness/` — so the checker stays outside what it
checks.

Import edges are extracted with a parser (`oxc-parser`), not a regex: a
side-effect `import "@kb/x"` and an `export … from "@kb/y"` are both edges, and
a scanner that keys on the word `from` sees the second by accident and the
first not at all — a fence you can cross by choosing a syntax is not a fence.
The installed TypeScript is 7, whose native port exports only `version` and
`versionMajorMinor`, so `ts.preProcessFile` is not available to do the job.
dependency-cruiser and `@nx/enforce-module-boundaries` were both rejected for
the fence itself: they take path-pattern rules, which would mean generating a
mirror of the tag matrix — the thing `4b63dff` removed.

One restriction the package graph cannot see is the **isomorphism fence** — a
`scope:shared` package runs in the browser too, so it may not import `node:*`,
`bun:*`, or `@effect/platform-bun`. It is stated once, beside the matrix in
`constraints.ts`, and the same `boundaries` check applies it to every import
under a shared package's `src/`. `.oxlintrc.json` carries no boundary knowledge:
it is categories plus the rules beyond them, and the only `overrides` are the
test-file and `.d.ts` file classes.

## Runtime/tooling boundary

The backend runs on **Bun** in production; the toolchain around it is **Vite+
(`vp` 0.2.8) + TypeScript 7**. The two are deliberately separated:

- **Bun is the production runtime.** `bin/kb` is a bash shim
  (`#!/usr/bin/env bash`) that `exec`s Bun on `packages/app/cli/src/main.ts`, the
  one process entrypoint; the `kb ui` server uses
  `Bun.serve`/`Bun.ServerWebSocket` as the listen/WS/`Bun.file` boundary while
  routing, assets, and the subscription hub are Effect programs; the store
  streams with `Bun.file`/`Bun.write`; `Bun.hash` powers change detection.
  These are appropriate Bun APIs and stay.
- **Root scripts are the entrypoints.** A fresh shell can run each with no
  prior setup:
  - `bun run typecheck` → `nx run-many -t typecheck`, one `tsc --noEmit` per
    package against `tsconfig.base.json`. This is the authoritative typecheck,
    and the pre-commit hook runs it when `tools/kb/` changes.
  - `bun run lint` → one
    `oxlint --config .oxlintrc.json --type-aware packages harness` over the
    whole workspace. Type-aware linting is on: `oxlint-tsgolint` is a
    declared devDependency, which is what makes its platform binary
    (`@oxlint-tsgolint/darwin-arm64`) install.
  - `bun run test` → `bun test packages`
  - `bun run test:ui` → the Vitest `test` script of every `scope:browser`
    project (`nx run-many -t test --projects=tag:scope:browser`)
  - `bun run test:dst` → the deterministic simulation sweep
  - `bun run knip` → the hard, unbaselined dead-code report for cleanup work
  - `bun run harness` → repository constraints plus the shared lint/Knip debt
    ratchet
  - `bun run verify` → typecheck + lint + format check + harness; Knip admission
    runs through the harness ratchet until its lane reaches zero
- **Two runners, split by package, not by file.** Every `scope:browser`
  package (`@kb/ui`, the kit, each family's UI half) runs on Vitest, because
  its suite needs happy-dom, `vi.mock` hoisting and fake timers; everything
  else runs on `bun test`. `bunfig.toml`'s `pathIgnorePatterns` keeps the
  browser packages out of `bun test` by folder instead of naming files, and
  `harness/tests/browser-scope.test.ts` holds those folders to the scope
  tags.
- TypeScript 7 removed `baseUrl`. `tsconfig.base.json` holds the flags, two
  runtime presets hold the runtime keys, and each package declares only its
  `include` and no `paths` beyond `@kb/ui`'s intra-package `@/*`.

### Compiler strictness contract

Three files, three jobs. `tsconfig.base.json` owns compiler strictness and
nothing else — no `target`, `module`, `moduleResolution`, `lib`, `jsx`,
`paths`, `types`, or `include`. Two runtime presets extend it and own the
runtime keys: `tsconfig.bun.json` (Bun target/module/lib, `types: ["bun"]`,
`allowImportingTsExtensions`, `noEmit`, and the one authored copy of the
`@effect/language-service` plugin block) and `tsconfig.browser.json` (DOM lib,
`jsx`, no Effect plugin). A package tsconfig names its `include` and the preset
its `scope` tag selects — `scope:browser` gets the browser preset, every other
scope gets the Bun one — and declares a compiler option only when
`SANCTIONED_TSCONFIG_DELTAS` in the harness records why it cannot be
inherited (today: `@kb/render-tests`'s DOM `lib`, `@kb/ui`'s `@/*` `paths`).

#### Effect diagnostic severities and their file scope

The `@effect/language-service` plugin block in `tsconfig.bun.json` is the one
place both the Effect severities and their file scope are authored, and every
`effect/*` rule sits in exactly one of two lanes:

- **counted** — `suggestion` in `diagnosticSeverity`, tallied by the ratchet
  ledger, promoted when its count reaches 0;
- **promoted** — `error`, so a new occurrence fails `bun run typecheck`.

Promotion carries a file scope, because the claim does. The Effect-native
preference group says "model this control flow as an Effect", which is a
statement about how kb's production code is written; a `test("…", async () =>
…)` callback is a test-runner calling convention, not kb modelling anything. So
a promoted rule is an `error` under a package's `src/` and stays a `suggestion`
everywhere else, expressed as the plugin's single `overrides` entry:
`include: ["packages/*/*/src/**/*"]` and no `exclude`. The harness lives outside
`packages/`, so that file scope already excludes it; a carve-out beside the
include would be a second list to keep in sync. That is the same scope
`countsTowardRatchet` applies while a rule is still counted — see "Ratchet
scope" — so a rule keeps its meaning as it crosses lanes.

The alternative — a second `tsconfig.bun.test.json` preset with a
`tsconfig.test.json` per package — was rejected: `plugins` does not merge
across `extends`, so the test preset would have to restate the whole plugin
block, and two hand-synced copies of the severity map is exactly the mirror
[Rule 1](../../CLAUDE.md) forbids. The per-path `overrides` keep one authored
block, one tsconfig per package, and one `nx typecheck` target per project.

Harness check `effect-severity-lanes` holds the shape: exactly one override,
carrying an `include` and no `exclude`; an override that only ever promotes
`suggestion` to `error`, never relaxes; and no rule both promoted and present
in the ratchet ledger.

The contract only reaches a file some `tsc -p` project includes, so harness
check `typecheck-scope` asserts that every TypeScript file under `tools/kb`
falls in exactly one typecheck project's `include` — one per package plus the
harness — the same question `lint-scope-coverage` asks of the lint scopes,
asked through the same reader.
A package that grows a directory and forgets to include it would otherwise
keep a green `bun run typecheck` over code nothing checks.

The table below is the single source of truth for strictness; harness check
`tsconfig-contract` parses it live and asserts `tsconfig.base.json` matches it
bit-for-bit, that neither preset redeclares a base flag, and that no package
redeclares a key its base or preset already owns.

| flag                               | value | status   |
| ---------------------------------- | ----- | -------- |
| strict                             | true  | active   |
| noImplicitOverride                 | true  | active   |
| noUncheckedIndexedAccess           | true  | active   |
| noFallthroughCasesInSwitch         | true  | active   |
| verbatimModuleSyntax               | true  | active   |
| noUnusedLocals                     | true  | active   |
| noUnusedParameters                 | true  | active   |
| noImplicitReturns                  | true  | active   |
| allowUnreachableCode               | false | active   |
| allowUnusedLabels                  | false | active   |
| noUncheckedSideEffectImports       | true  | active   |
| erasableSyntaxOnly                 | true  | active   |
| forceConsistentCasingInFileNames   | true  | active   |
| useUnknownInCatchVariables         | true  | active   |
| skipLibCheck                       | true  | active   |
| exactOptionalPropertyTypes         | true  | deferred |
| noPropertyAccessFromIndexSignature | false | rejected |

`exactOptionalPropertyTypes` is deferred to `d1`/`d2` code drains (17 backend +
31 UI violations recorded in `reports/measurements.md`).
`noPropertyAccessFromIndexSignature` is rejected (plan D9; 114 backend + 239 UI
violations, style-only with no soundness gain).

### Ratchet scope

The ratchet ledger (`harness/lint-warn-baseline.json`, harness check
`lint-warn-ratchet`) ingests oxlint, Effect diagnostics, and Knip. Every
collector reports health alongside findings; an execution or decode failure is
a gate failure, never an empty result. The lint collectors measure different
file sets on purpose.

- **oxlint** counts every warning over every linted file: the collector runs
  the root `lint` script itself, so the lint scope is authored once and the
  ledger cannot drift from what the gate lints. Where a rule means something
  different in a test, that is said once in `.oxlintrc.json` `overrides` — the
  file glob is the scope, and the ledger just follows it.
- **`@effect/tsgo`** has no per-file severity, so the scope lives in the
  collector instead. Correctness-severity diagnostics count wherever they
  appear. Suggestion-severity ones — the Effect-native preference group
  (`asyncFunction`, `globalConsole`, `globalDate`, `globalTimers`,
  `processEnv`, `globalRandom`), emitted by tsgo as `message` — count only
  under a package's `src/`, which is kb's production code.
- **Knip** contributes one stable identity per dead-code finding to the same
  blocking ledger. Its raw script remains a hard report for cleanup work;
  normal admission compares the complete decoded finding set with the
  committed lane, so both rises and partial improvements require an explicit
  `bun run harness:snapshot` update.

Rejected rules are recorded here with their measured count, like rejected
compiler flags: `oxc/no-map-spread` (14 sites) — a micro-optimisation for
`Array.prototype.map` callbacks that spread; kb's arrays are small, the
rewrite (`Object.assign` or field-by-field copies) is less readable, and
refrepo keeps it at `warn` only because it never measured it.

The reason is what the suggestion lane claims. `asyncFunction` says "model this
control flow as an Effect"; that is a statement about how kb is written, and a
`test("…", async () => …)` callback is a test-runner calling convention, not kb
modelling anything. Counting those made 235 of 303 `asyncFunction` hits
untouchable-by-design, so the ledger's largest number could only ever move by
re-snapshotting — a rule nothing can satisfy is a rule nothing enforces.
`countsTowardRatchet` in the harness states the split once, and
`ratchet-scope` is its red case.

Promotion carries the same scope. A suggestion rule that reaches 0 in `src`
but still has hits outside it _is_ promotable, because the severity flip in
`tsconfig.bun.json` is file-scoped too — see "Effect diagnostic severities and
their file scope". The collector and the plugin state one scope, not two: a
package's `src/`, with nothing carved out of it.

## Supply chain

- Every internal dependency is `workspace:*`; every external dependency is
  `catalog:`. The catalog in the root `package.json` is the only file that
  names a version, with no exceptions; the vite alias twin lives in the catalog
  and the harness asserts it tracks `vite-plus`.
- One `bun.lock`. CI installs with `--frozen-lockfile`.
- `bunfig.toml` `[install]` sets `minimumReleaseAge` (3 days) and an explicit
  `trustedDependencies` allowlist, which is empty: nothing in this tree runs
  code at install time.

## Spec-first changes

This file is the spec; the code is one materialization of it. A change edits
the spec section first, in the same change and earlier in commit order, then
the code follows. If the section cannot be written, the code cannot be written:
vagueness in prose is the cheapest place to discover an under-specified
decision, and vagueness in code is the most expensive. When the implementation
wants something the spec does not authorize, that is a signal to revise the
spec — not a licence to expand intent quietly in the implementation.

When the spec must temporarily lag the code, the lag is written down first: a
`#gap` node and a `// GAP [[id]]` marker (see
[Drift markers and gaps](../../CLAUDE.md#drift-markers-and-gaps)). The goal is
not zero drift; the goal is visible, intentional drift.

## Testing doctrine

The long form of the evidence behind this section is
`docs/kb/waves/2026-09-03/reports/recon-refrepo.md` §4; what follows is the
part that governs kb.

**Properties are design artifacts, not test volume.** A property states a
falsifiable domain claim, and falsifiability runs from the **rejecting** side:
an accept-everything round-trip is not a property. Three anti-patterns are
named so a reviewer can cite them:

| anti-pattern       | shape                                                                                  | why it has no power                                    |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| TAUTOLOGY          | the oracle re-implements the function under test                                       | passes for every implementation, including a wrong one |
| STRUCTURAL         | asserts what the type system or `Schema` already guarantees                            | the negation is unrepresentable                        |
| quantifier theatre | `fc.constantFrom` over two or three values, or a filtered generator wearing a `forall` | claims coverage it does not have                       |

The keeper classes are metamorphic relations (idempotence, injectivity,
invariance, erasure — `store-roundtrip`, `order`, `mentions` are all of this
kind), fail-closed backstops, precedence, conservation/projection, and
cross-function agreement. Mutate one field and assert the rejection _names the
violated path_. Determinism is mandatory: no wall clock, no unseeded
randomness, fixed seed in CI, and a failure prints seed plus counterexample. A
pure function is not by itself a reason to write a property.

**Coverage is a signal, never a gate.** It may be reported; there is no
"fail below N%" check and there will not be one. Chasing a percentage
manufactures exactly the noise this doctrine forbids.

**The mutation score is advisory.** Stryker runs weekly (`kb-mutation.yml`)
over `@kb/model`, `@kb/query` and the CLI's argument mapper, with no
`thresholds` block. The run seeds fast-check (`KB_FAST_CHECK_SEED`), so its
survivor list is reproducible. It is a sensor a human reads to find a missing
test, not a merge blocker: a gate that slow gets routed around, and a score is
not a claim about any one change. The harness's `advisory-signals` check
holds both halves.

**Size is a signal; boundaries and branching are the gate (L1/L2/L3).**

- **L1 — structural, hard (`error`).** Cross-unit coupling: import cycles,
  layer direction, a unit reaching past another's public surface. Mechanical
  and non-negotiable.
- **L2 — within-unit sensors, two tiers.** _Branching_ sensors (`complexity`,
  `max-depth`, `max-nested-callbacks`) are hard, because they measure shape
  directly; the caps are refrepo's (`complexity` 20, `max-depth` 5,
  `max-nested-callbacks` 4). _Size_ sensors (`max-lines` 900,
  `max-lines-per-function` 120, `max-params` 5) only ever `warn`: a
  legitimately large cohesive unit is real, and a length cap forces exactly
  the bad split a reviewer would have to reverse. A long but flat body of
  well-named steps is good code. Function-length and callback-nesting are
  measured over `src` only: a `describe`/`test`/`fc.property` body is the
  runner's structure, not a unit kb wrote.
- **L3 — cohesion, advisory.** "Is this one responsibility?" is a review
  judgement, never a merge blocker.

A unit may be long; it may not be tangled.

## Domain typing — Effect `Schema`

Once a domain value is parsed, narrowing on its discriminator hands back the
right field shape with no further checks: no `!`, no `as`, no field that
"exists for one variant but not another".

- **An id is never the empty string.** A `NodeId` — and every binding whose
  name or type says id or key (`nodeId`, `canvasId`, `afterSiblingId`,
  `focusId`, `instanceKey`) — is present or absent, never present-and-empty.
  So an id is tested with `!== undefined` / `!== null`, and `""` carries no
  meaning the code may branch on. Display text is the opposite: a label, a
  colour, a title or an error message can be present-and-empty, which is a
  state the UI decides about, so `@kb/ui`'s `lib/text.ts` (`hasText`,
  `textOr`) owns that test in one place.
- **No optional-where-discriminated.** If a field is sometimes present and the
  rule for when it appears is encodable, do not write `field?: T` — lift the
  rule into a discriminator. `KbNode.order?` is the case that looks like an
  exception and is not: absence is a real state with no rule to encode. A node
  is unranked until a commit writes its sibling group, and a node handed to the
  store without a rank, or written outside kb, is exactly that; the store ranks
  it on that commit ([Sibling ranks](#sibling-ranks)), so no reader waits for a
  migration to make the field total. What stays one test is the asking: no
  reader compares `order` against `undefined`; `rankOf` (a `NodeRank` union) is
  the one way, and `KbNodeSchema` declares `order: optionalKey(NonEmptyString)`
  so absence is the only way to be unranked.
- **Discriminators are literals**, never `Schema.String`. `PropValue.t`,
  `ActionReceipt.status`, `ServerMessage.op`, `MemberReason.kind` and
  `DomainError.code` are the model's discriminators and each is a literal
  union; a `switch` over one is exhaustive by construction.
- **One canonical schema, never re-declared inline.** A shared shape is
  declared once and referenced. An inline copy that drifts by one field is the
  classic way to drop data on a round trip.
- **Parse `unknown` at every boundary.** A boundary's parameter is `unknown`
  and its first act is a decode; that is validation, not a cast. Finding
  yourself writing `node.props[id]!` means the schema is too loose — tighten
  the schema, do not bypass the type.
- **A node-backed config decodes through one Schema, and says what it
  ignored.** A graph view node and a view frame are the same kind of
  thing — a node whose props configure a projection — so both decode through
  `@kb/model`'s `node-config` rather than a hand-written branch per field. A
  config declares a table of slots; a slot names the field node it reads, the
  **carrier reader** that projects the stored `PropValue[]` to one candidate,
  the **carrier writer** that stores a value back (`SlotWrite`: each field it
  reads, replaced whole), the `Schema` that says what is legal, and the value
  used when the store says nothing. Carrier and validity stay apart: "the
  first `num` value of `lens.max-nodes`" is a projection, "positive and
  whole" is the schema. A default has exactly one home — the slot, beside the
  shape it defaults to — never the ontology _and_ the function. A slot reads
  back what it writes, so a setting is written in no second place: a new
  graph view node's props (`encodeNodeConfig`) and a frame toolbar's edit
  (`frameSettingWrite`, through `encodeNodeSetting`) are the slots' writes,
  and every slot table's tests hold the round trip.

  The malformed-input policy is part of the mechanism, not per call site:

  - An **absent** prop is _unset_. The declared default applies, silently.
  - A **present** prop the slot cannot read — wrong carrier, or a value the
    schema rejects — falls back to that same default **and is reported**,
    naming the field node and what was expected. Nothing throws: a bad prop
    must never make a graph or an outline unopenable.
  - Props are multi-valued, so a **multi-valued** field decodes per value —
    one bad clause is reported by its index and the readable ones survive —
    while a **single-valued** field is one value and decodes whole.
  - An element that decodes to `null` contributes nothing and is _not_
    reported. That is how a documented sentinel says "explicitly empty": the
    `none` source option stored in `lens.edge-kinds` means no edges, and is a
    value, not a mistake.

  A decode reports to the sink its caller passes; `@kb/ui` passes its log
  seam (`lib/log`). Surfacing them in the
  UI the way `resolveOntology`'s warnings are surfaced is
  GAP [[01M1XF1NA2RBAX1E6NNX6PMZ6N]].

## Data model — everything is a node

```ts
type NodeId = string; // ULID, or "sys.*" for seeded system nodes

interface KbNode {
  id: NodeId;
  text: string;
  props: Record<NodeId, PropValue[]>; // key = FIELD NODE id, not a string
  children: NodeId[]; // ordered outline
  order?: string; // fractional sibling rank; absent until a commit ranks it (see Sibling ranks)
  createdAt: string;
  updatedAt: string;
}

type PropValue =
  { t: "str" | "num" | "bool" | "date"; v: string | number | boolean } | { t: "ref"; v: NodeId };
```

- **Fields are nodes.** A field is just a node typed `sys.field` (e.g. node
  `01J..X` text "status"). `props` keys are field-node ids, so fields are
  reusable anywhere, renameable in one place, and can carry their own props
  (description, allowed values) later. Attaching any field to any node is
  legal — tags only _template_ fields, never restrict them (Tana semantics).
- **Tags (supertags) are nodes** typed `sys.tag`, holding a `sys.f.fields`
  prop listing field-node refs they template. Applying a tag = adding a
  `sys.f.type` ref prop. Multiple tags per node allowed.
- **Ref targets are declared on the field node**, by exactly one of three
  carriers: `sys.f.targetQuery` (general form — parameter-free EDN whose rows
  name node ids), `sys.f.targetTag` (sugar — union of the listed tags'
  instances), or **the field node's own children** (the option-set shape — no
  field, no prop; the parent–child datom is the declaration). Precedence is
  query → tag → children, and the first present carrier is the only one
  consulted: two declarations would answer one question twice. The children
  carrier is derived into EDN (`childrenTargetQuery`) and run through the same
  injected runner, so the resolver is one shape — derive a query, run it —
  rather than a query path with a `children` branch bolted beside it.
  Resolution lives in `@kb/model`'s `field-type.ts` (`allowedRefIdsOf`, EDN
  runner injected) and is shared by CLI, MCP and the browser through
  `@kb/model` — same posture as the ontology resolver.
- **Hiding `sys.*` is a display rule, never a resolution rule.** Resolution
  surfaces — ref-target constraints, ontology membership, datalog, validity
  checks — read the kind slot (`typeRefsOf`, i.e. `sys.f.type`) and return
  everything it names, seeded ids included: `sys.f.fieldType` legitimately
  targets six `sys.ft.*` options and `sys.f.onto.include` legitimately targets
  every supertag. Display surfaces then decide what to _show_: an unconstrained
  ref picker hides infrastructure (`nodeCandidates` in `ui/src/lib/refs`),
  and the outline's `#tag` badge list omits the kind refs so a tag's own page
  shows no "#tag" chip. Those two lists are not interchangeable — reading the
  badge list back as membership reports every supertag as untagged, which is
  what once left `sys.f.onto.include` with an empty allowed set. Write
  protection is a third, separate concern (`isSysPrefixed` + `--force`);
  referencing a `sys.*` node as a _value_ is not a write to it.
- **System nodes**, seeded on init, are ordinary nodes with reserved ids:
  `sys.field` (the type of fields), `sys.tag` (the type of tags),
  `sys.f.type` (the "type/tag" field), `sys.f.fields` (tag→templated fields).
  That's the whole special set; everything else is user space.
- **Every seeded field declares its value type** (`sys.f.fieldType`), text
  ones included. `fieldTypeOf` reads an absent type as text, which is the
  right default for a user's untyped field and the wrong one for nearly every
  system field (`sys.f.type` holds refs, `sys.f.hidden` a bool), so no system
  field leans on it. The seed's fill-absent pass carries a declaration added
  later to stores seeded before it.
- **A node's own text is a field a view can name** — `sys.f.node.text`, the
  table's Name column. It holds no values (text is `KbNode.text`, not a prop);
  it exists so a view that sorts or sizes by name refers to a node, exactly as
  it does for every other column, instead of to a sentinel id no node has.
  Views saved with that old sentinel (`"__name__"`) are read through it: the
  view-config readers resolve the sentinel to the field in sort keys and in
  column widths, so the next write of either stores the real id, with no
  migration pass.
- **A written value conforms to its field, or the write fails.** Tags never
  restrict which fields a node carries; a field's declared type does restrict
  what it holds. Each type accepts fixed value kinds (`acceptsValueKind` in
  `field-type.ts`, the one table the UI's mismatch hint also reads): text and
  url → `str`, number → `num`, checkbox → `bool`, ref → `ref`, and date →
  `str` (a local `YYYY-MM-DD`; the legacy `{t:"date"}` carrier is rewritten on
  open). A value of the right kind must also be in its type's form (`field-value.ts`,
  the one statement of it: a url is a canonical link, `normalizeUrl`), and every
  surface parses raw input through the same `parseTypedValue`. A `ref` must
  also name a node the graph stores. The check (`valueConformanceError`) is part of
  `txIntegrityError`, so it runs where outline integrity already runs —
  `persistEffect`, which every action on every surface (CLI, MCP, HTTP/WS, the
  browser's local replica) commits through, and `@kb/client`'s commit — and a
  violation is the same `invalid_input` DomainError. What it checks is the
  values a transaction _writes_: those an upserted node holds that its stored
  version did not. A field may also declare how many values it holds:
  `sys.f.cardinality`, a ref to one of its own children `sys.cardinality.one`
  / `sys.cardinality.many` (the option-set shape, like `sys.f.fieldType`), with
  absence meaning many — except that a type may cap it: a checkbox holds one
  value whatever it declares (`cardinalityOf`, the one reader). A write that leaves a `one` field holding two values
  — a duplicate of the held value included — is refused by the same check.
  What "set" means is the field's to say, in `node.update`'s one prop writer:
  setting a `one` field replaces its value in the same transaction (so `kb
set`, MCP and the UI all replace in one write), a many-valued field gains
  the value, and a replacement is never an unset and a set in two
  transactions. Every seeded setting declares `one`.
  Values already stored are not rechecked, so a legacy store
  stays editable and a node's unrelated edit never fails over an old value;
  the cost is that a retype or a delete can strand values (a recorded gap). A
  ref field's _target constraint_ (`allowedRefIdsOf`) is not part of the check
  yet — only the picker applies it (a recorded gap).
- **Name resolution**: CLI/actions accept field/tag _names_; resolver does a
  unique-text lookup among `sys.field`/`sys.tag` nodes (error on ambiguity,
  `--create` to mint). Resolution is dynamic at load — at our scale (\<\<100k
  nodes) caching is premature; revisit only if load profiling says so.
- **A CLI value is parsed as its field's declared type**, never guessed from
  its shape (`parseFieldValue` in `@kb/operations`' `map.ts`): `kb set <n>
<field> 42` writes the string `"42"` into a text field and the number `42`
  into a number field, a ref field takes the argument as a node id, and a
  checkbox takes `true`/`false`. An argument the type cannot read (`abc` for a
  number) is a usage error, exit 2. A field that does not exist yet reads as
  text, which is what `--create` mints. There is no per-value type flag: the
  field already says what its values are, and a flag that disagreed with it
  would only be refused by the write check.
- **Refs / `:node/mentions` (the reference relationship, carrier-independent).**
  Two things carry a reference in this model, and `:node/mentions` is emitted
  from **both**:
  1. a wiki-link in **text** — `[[node-id|label]]` or bare `[[node-id]]` —
     whether the text is the node's own `text` or a `{t:"str"}` value it
     holds (`nodeMentions` in `@kb/query`): a text field's value is written,
     rendered and followed exactly like node text (DESIGN-UI.md → Field
     values), so a token in it references exactly like one in node text;
  2. a `{t:"ref"}` **prop value** — a typed field pointing at a node.

  At datom build time each distinct target of either kind becomes one
  `:node/mentions` ref datom on the source (deduplicated per source→target,
  since the attribute is cardinality-many) — same shape as Logseq
  `:block/refs` (parse-at-transact). The UI renders inactive text refs as
  accent links (click = zoom, ⌘/Ctrl-click = jump); the relationship itself is
  queryable, not UI-only. Example — nodes that reference a target:

  ```
  [:find ?from ?text
   :where [?e :node/mentions ?m]
          [?m :node/id "n.root-a"]
          [?e :node/id ?from]
          [?e :node/text ?text]]
  ```

  (`kb backlinks <id>` is the shorthand; `@kb/query`'s `queries.ts`
  `backlinksQuery` is the single owner of that EDN, and the browser reads it
  through the `@kb/queries` alias rather than keeping a copy.)

  **Why both carriers, one attribute.** A ref prop _is_ a relationship. When
  only text tokens produced the datom, `kb backlinks` and the UI's References
  section silently missed every prop-borne reference — a status value did not
  know its tasks, a tag did not know its instances, and a contextual reference
  did not appear on the node it referenced. The alternative (ask twice and
  union at each call site) is the second `if` on one distinction that Rule 1
  forbids, so the fix belongs in the relation, not in the question. The carrier
  distinction survives exactly where it is a genuine lens: the graph's
  `mention` / `child` / `ref-prop` edge kinds label provenance, and each is
  therefore read from its own carrier (`collectEdges` in `ui/src/lib/graph-lens.ts`
  scans text tokens — `nodeMentions`, the same reader the datoms use — children
  and ref props separately and never queries `:node/mentions`, which would
  double every prop edge).

  Optional Logseq-style `:node/path-refs` (ancestor mentions) is backlog —
  add only when a real query needs hierarchy-scoped reach.

- **Contextual references** (Tana references) are the node kind built
  on that relation: an ordinary node carrying `sys.f.ref.target`, a ref prop
  naming a target. The field is the whole declaration — there is no `#ref` tag,
  because a node with no target is not a reference at all (see
  [Kinds, roles and options](#kinds-roles-and-options)). Its row shows the
  target — current text, tags, fields and children — at the reference's place;
  the reference node owns only that place — a new node _kind_, not a new node
  _type_, exactly like a query node. Anatomy and the rendering and editing
  rules are in
  [DESIGN-UI.md → Contextual references](./DESIGN-UI.md#contextual-references-2026-08-27).
  Creating one needs no new action:

  ```bash
  kb action-invoke '{"id":"node.add","input":{"text":"","parent":"<host>",
    "props":[{"field":"sys.f.ref.target","value":{"t":"ref","v":"<target>"}}]}}'
  ```

- Datom mapping: `[id :node/text v]`, `[id :node/child child]` (+order),
  `[id :f/<fieldId> v]` with ref values as entity refs → native datalog joins
  and graph traversal.

### Sibling ranks

A sibling group is a parent's `children`, or the forest roots. A child's place
is its index in the parent's array; the forest roots have no array, so their
order is each root's `order` rank. Every node carries a rank all the same, kept
consistent with its group's visible order, so that a node moving between the
two kinds of group already has one that fits. The home of the mechanism is
`@kb/model`'s `order.ts`, and every writer goes through it: the create and
move operations, every store's commit, the merge, and — through the operations
— the UI, which sends only a position.

- **A rank is a variable-length base-36 fraction.** `rankBetween(a, b)` is
  always strictly between its bounds, because a rank can always grow by a
  character; a head or tail insert steps the first digit that can move instead
  of halving the gap. No rank ends in `0` (it would tie with its own prefix);
  a bound that does is read without it. The property test beside it holds
  `a < between(a, b) < b` for any two ranks, long ones included.
- **A placement is a position, and the rank is derived.** `node.add` and
  `node.update` take `parent` and `position` — the index in the target group,
  the end when omitted — and never a rank. `rankForInsert(siblings, position,
current)` is the one derivation; it keeps a moved node's rank when it still
  fits, so re-placing a node where it is writes nothing. `compareRootOrder` is
  the one root comparator (ranked first by code units, then id), and
  `siblingSlots` the one group view a position indexes, on the server and in
  the UI alike.
- **The commit settles ranks; the store promises it.** Every `EffectStore`
  adapter passes each transaction through `rankTx` against the state it is
  about to merge into, inside its own exclusion, and applies, records and
  reports (`StoreCommit.tx`) that result. `rankTx` repairs every group the
  transaction touches — a member upserted, or the parent whose array it is —
  so that every member is ranked, ranks are well formed and at most 12
  characters, and they strictly increase along the visible order. It keeps
  what already fits, places the rest between their neighbours, and re-spreads
  a group only when it holds a rank no writer could have produced. A node
  committed without a rank therefore gets one, and two writers that appended
  from one read never leave two siblings on one rank: the second commit sees
  the first. Untouched groups are left exactly as stored. `storeContract`
  holds all of this for every backend.
- **A merge settles ranks like a commit.** `mergeNodeSets` ends with the same
  `rankTx`, so two branches that each appended a root from one read never
  merge into a tie ([Merge](#merge)).
- **Opening is a read.** `openKb` writes only when a real migration runs (the
  seed adds or retires something, or a field-type value or a legacy
  `{t:"date"}` value is rewritten), and
  then commits exactly the nodes it changed. A node without a rank is ordered
  in memory by `compareRootOrder` and ranked by the next commit that writes its
  group, so reopening a store leaves its bytes, fingerprint and tail alone.
  A store written before view nodes is not one of those: opening only warns
  that it holds the old shapes, and `views.migrate` rewrites them
  ([View nodes](#view-nodes)).

### Merge

`mergeNodeSets(base, ours, theirs)` is the one three-way merge of two node
sets against their common ancestor; the git driver for `nodes.jsonl` is only
its boundary (tools/kb/AGENTS.md → merging `nodes.jsonl`). It resolves by node
id and, within a node, by **concern**: a concern that only one side changed
takes that side, whatever either side did to the node's other concerns. Given
two stores it never throws and always returns a store — a forest, every node
ranked — and whatever it could not decide it names as a conflict, keeping one
side's value so nothing is lost.

| concern   | what it is                                                                  | changed when                        | both sides changed it, differently                                                           |
| --------- | --------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| existence | the id is in the set                                                        | a side added or deleted it          | only a deletion can disagree — rule 1                                                        |
| content   | everything but `id`, position and `updatedAt`: `text`, `props`, `createdAt` | its bytes differ from the base's    | the newer `updatedAt` wins; an equal stamp keeps ours and reports `modified-both-same-stamp` |
| position  | the parent id and the rank, **one value**                                   | either part differs from the base's | ours, reported `modified-both-position`                                                      |

A node's slot among its siblings is its rank, so a reorder, a reparent and a
re-rank are all the one position concern: one side's reorder and the other
side's reparent of the same node conflict rather than combine into a place
neither side wrote. Each side is read as the store would commit it — `rankTx`
over the whole side — so every rank agrees with its group's visible order; a
committed side reads back unchanged.

1. **Existence is decided from the three sides alone.** An id both sides
   hold, or that one side added, lives. An id one side deleted is gone when the
   other side's copy has the base's content and position — a stamp alone is
   not a change — and otherwise lives, reported `deleted-and-modified`.
2. **Content and position merge three-way** by the table. A node only one side
   holds takes that side whole. `updatedAt` is content's clock, not content:
   the merged node carries the stamp of the side whose content it took, or the
   later stamp when both sides' content agrees.
3. **Children are derived, never merged.** A parent's `children` are the
   living nodes whose merged parent it is, in rank order (then id); every
   other living node is a root. No side's `children` array is read after it
   has given each node its parent, so no child can dangle or have two parents.
4. **The forest is closed by two rules**, repeated until neither applies:
   - _A living node brings back its merged parent_ when that parent is gone,
     with the version of the side that kept it. The parent is reported
     `deleted-and-modified` unless the node that brought it back is itself
     reported or itself brought back — that report already names the
     decision, so an edited leaf against a deleted subtree is one conflict, on
     the leaf.
   - _A cycle adopts ours._ Each side is a forest, so a cycle can only join
     positions taken from different sides. Every node on it that ours holds
     elsewhere takes its whole position from ours, once, and is reported
     `modified-both-position`. Ours is a forest, so this ends; should a side
     not be one, the cycle's least id becomes a root instead.
5. **Ranks settle as a commit's do**: `rankTx` over the result. Order along
   each group is kept; only ties and unusable ranks are rewritten.

Swapping ours and theirs changes nothing unless a conflict is reported:
"ours" is only ever the tie-break of a reported conflict.

### Kinds, roles and options

**A supertag says what a node _is_. A behaviour is a field. An option set is
children.**

Everything is a node, and a tag is a node too — but that is a statement about
_storage_, not a licence to express every distinction as one. Three carriers
exist and they are not interchangeable:

| carrier                                    | says                                                  | example                                                                                       |
| ------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| supertag (`sys.f.type` → a `sys.tag` node) | this node **is a** thing of that kind                 | `#rule`, `#gap`, `#check`, `#ontology`, `#todo`                                               |
| field (a `props` key)                      | this node **does** something, or **has** an attribute | `sys.f.query` (a query node), `sys.f.ref.target` (a contextual reference)                     |
| children                                   | these nodes **are the values** the parent may take    | `sys.ft.text` … under `sys.f.fieldType`; `prose lint tsc harness hook ci` under `enforcement` |

**The strip test**, applied before minting a tag: remove the behaviour and ask
whether the node is still that thing. A `#gap` with no `expected` is still a
gap — badly filled in, but a gap — so `gap` is a kind and earns a tag. A node
with no `sys.f.ref.target` is not a reference, it is a plain node, so `ref` is
a _role_ the field already carries and a `#ref` tag would be a second carrier
for one distinction (Rule 1's second `if`). `lint` is not "a check-surface", it
is one of the values `surface` may take, so it is a child of that field.

Two consequences the code depends on:

- **A kind is read from its carrier, never from a display list.** `isQueryNode`
  asks whether `sys.f.query` is present; `contextualTargetOf` asks whether
  `sys.f.ref.target` names a node. Neither consults `node.tags`, which is a
  badge array that deliberately drops kind refs, and neither matches a tag by
  _name_ — a user tag called `query` is a user tag.
- **An option set needs no tag to group it.** Siblings under one parent are
  already a set, and `allowedRefIdsOf` derives the picker's candidates from
  exactly that (see the ref-targets bullet above). This is what "in Tana you
  just add a node" means: a user's own option list is a child added under the
  field, with no supertag minted and no bespoke editor.
- **One list, several fields: the parent is a list node and each field selects
  from it.** A node has one parent, so an option set used by more than one
  field cannot be all of their children. Then the options are children of an
  ordinary list node — no tag on it either, being the node those queries read
  is the whole of what it is — and each field declares the subset it accepts as
  a `targetQuery` over that list. `surface` does it by excluding a sibling
  (`enforcement`'s children minus `prose`); the five graph source fields do it
  by partitioning on a field the options carry (`sys.graph.sources`' children
  filtered by `sys.f.graph.source.kind`). This is still one mechanism — a
  declared query over the option nodes — not a fourth carrier: `targetQuery`
  is the general form and parenting is the sugar for the single-field case.

`#ontology`, `#rule`, `#gap`, `#check`, `#todo`, `#canvas` and
`#approval-policy` remain supertags because each names a thing that exists before any particular field
is filled in, and each templates a field set for its instances — which is the
job a supertag has. `#graph-perspective` was one and is retired: strip a
perspective's renderer and it is no graph, so what it is is the view it
names, a field (View nodes, below).

#### View nodes

**A view someone chose is a node.** A view is a projection of the graph
rendered in a box its host owns (DESIGN-UI.md → UI points: routes and
views); which view, with which settings, shown for which node, is data, so
it persists, syncs, answers queries and outlives the plugin that draws it.
The vocabulary is `@kb/model`'s `view-node.ts`; the plan it comes from is
`docs/kb/waves/2026-09-24/briefs/plugin-composition.md` §3, phase A1.

- **The view is a field, not a tag.** A node carrying `sys.f.view` (ref, one)
  is a _view node_; strip the field and it is a plain node, so there is no
  `#view` supertag (the strip test above). Its other props are that view's
  params: the view's key reads them (`ViewKey.config.read`), writes them
  (`config.write`, the inverse) and its params schema
  decodes them, so a prop the view cannot read is reported by the field it
  names, never guessed around.
- **Views are option nodes.** `sys.f.view` targets the children of the list
  node `sys.views`, one option per view kb provides, with id
  `sys.view.<view id>` — derived from the view's id, so a key and its option
  cannot disagree. An option of a family (`graph.renderer`, `outline.frame`)
  carries `sys.f.view.family`, a ref to one of that field's option children,
  which is what a query partitions the options by: the graph sources' shape
  (one list, several fields). Each option is derived from a declared view's
  key — its id, `label` and `family` — when the bundled seed is folded
  ([Extension families](#extension-families)), so no option is declared
  twice, and the view contract holds every provided view's key to a seeded
  option in its own family. Core's declaration lists core's views only; a
  feature's views are its family's declaration's.
  An unloaded plugin never deletes an option: the data outlives the code.
- **The view catalog is the keys.** Every view's key — its id, option,
  label, family, its settings as an Effect `Schema` (annotated with what the view
  shows and what it is shown for) and how a view node's props are read into
  them — is data (core's views in `@kb/views`, a feature's in its family's
  shared package), held by the UI that draws the view and the server alike. A host's catalog is the keys its loaded plugins contributed
  to `ViewKeyPoint`, read through the `ViewCatalog` service
  ([Extension families](#extension-families)); the UI's view contract holds
  every view a plugin provides to a key in the page's catalog. `kb.manifest`
  publishes the catalog beside the actions: per view its id, option, label, family, its
  settings as the JSON Schema the key's params derive
  (`Schema.toJsonSchemaDocument`, the JSON they decode from), and the
  settings a view node holding none reads as, where one can be read. The
  catalog states nothing a key does not, so an agent reading it reads what a
  host decodes.
- **A proposed view is checked by its key, in one place** (generative UI
  mode A: the model writes one view node). `view.propose` — a write with no
  approval that needs only the store and the index, like `node.add`, so it
  runs wherever the caller's store is — takes a view from the catalog (its
  id or its option), settings for it and, optionally, the node it is shown
  for. Its whole check is `@kb/views`' `viewNodeFor`: the settings decode
  strictly by the view's params (every setting legal, none it does not
  declare), are written by the key's `config.write`, and must read back
  through `config.read`, for that host, as the same settings with nothing
  reported. A setting the view takes from its host or its route, which a
  view node therefore cannot hold, is refused by its path. On success the
  node is filed at the end of the Views list and named in the host's
  `sys.f.views` (first when `default`); otherwise nothing is written and the
  receipt carries every issue as `{path, message}`. Any other entry that
  makes a view node from settings is to call the same function. The write
  check does not yet: a view node written through `node.add` or
  `node.update` is not checked against its view's settings
  (GAP [[01M40X308W34T0PGSN12S9K2K2]]). The frame toolbar's edits need no check of their
  own, because each writes one setting through its slot (`frameSettingWrite`),
  which reads back what it writes. A graph view proposed this way holds its
  renderer's settings only: which nodes it draws (`lens.query`, the
  mappings, the edge kinds) is the graph host's lens, which no renderer's
  params declare, so it draws every node until edited
  (GAP [[01M40X30Q8N7NYCYHW3J0GFKY7]]).
- **A view node renders as markdown where a surface shows text only.**
  `render.view` takes a docs view by name or any view node by id (exactly
  one), shown for `host` (by default the one node naming it). A docs view
  renders through its template whichever way it is asked for; any other view
  node renders as its text (`viewText` in `@kb/operations`): a heading naming
  the view and the host, then a body, and on an html page a figure above it.
  A view that can say itself in text draws its own body (and figure), the
  `ViewDef.text` its contribution carries, found in the host's view catalog
  ([Extension families](#extension-families)); any other view's body is the settings its key reads from the node for that
  host, and the nodes it shows — its lens query's when it holds one, else
  the host's children. One function (`renderViewNodeEffect`) serves the
  action and MCP's `ui://kb/view/*` resources (Surfaces). That generic body
  lists the view's subject; it does not lay it out the way the view does —
  filtered, sorted, grouped, a column per field, drawn as a graph
  (GAP [[01M40X30G92A0E57C02JHQ9A1G]]).
- **A host names its views by ref.** `sys.f.views` (ref, many) on any node
  targets every view node (`VIEW_NODE_TARGET_QUERY`). Scope is per node:
  a view shown for every node of a tag would be a new model rule
  (tag-level inheritance), which this does not add. Many hosts may name one
  view node, which makes it a template: an empty focus means the node it is
  shown for.
- **One of a host's views is its default: the first it names.** Order in
  `sys.f.views` is the one mechanism (`defaultViewIdOf`); making another view
  the default is moving it first, in one replacement of the field
  (`viewsWithDefault`; the node menu's "Make default view", offered on a
  host for each later view and on a view node for each host naming it
  later). An
  explicit `default` ref was the alternative and is refused: it is a second
  field that can name a view the host does not list, and it would have to be
  kept in step with the list by hand — a mirror.
- **Placement is not stored yet.** Each view is shown at the placement its
  host offers. A stored placement arrives with the hosts that read it, in
  phase A2 (GAP [[01M3EZR20H0CDF5MD01M2S26C5]]); a field no host reads
  would be a dead seam.
- **A neighbourhood is a lens narrowed to a focus and a hop bound.**
  `sys.f.lens.hops` (number, one) bounds it, `lens.focus` roots it, and
  `lens.edge-kinds` says along what. Its nodes are the union of both
  directions: `reach` is directed, so the neighbourhood runs
  `@kb/query`'s `neighbourhoodQuery` once per edge and direction and unions
  the rows, because the union as one query needs `or`, which runs raw
  (GAP [[01M39X8RPQBWFVDNG77BB3ZCMH]]). Even the union misses a path that
  changes direction (a→b←c); a symmetric edge relation would be the true
  undirected form.
- **A graph is a view node whose view is a renderer.** Its `sys.f.view`
  names the renderer, and its lens props are that renderer's params; the
  graphs a surface lists are the view nodes whose view is in the renderer
  family (`familyViewNodesQuery`). The seeded "All mentions" graph
  (`lens.all-mentions`) is one. `lens.renderer` is kept for the one graph
  view that hosts another renderer — a neighbourhood — and targets the
  renderer views (`viewFamilyTargetQuery`).
- **A view node the UI makes is filed in the Views list** (`views`, seeded,
  user-editable like the Pinned list, because every new view writes a child
  into it). Being a view node is its `sys.f.view`, never membership in that
  list; a view node filed anywhere else is as much one.
- **A frame's view is the first frame view node it names.** Which of the
  frame views (list, table, board, cards) shows a frame's children, and with
  which settings (`sys.f.view.sort`, `…display`, `…colwidth`, `…pagesize`,
  `…group`, `…filter`), is the first view node in its `sys.f.views` whose
  view is of the frame family (`familyViewIdOf`, read from the option's
  `sys.f.view.family`): its `sys.f.view` and its params. That is the
  frame's default unless it names a view of another kind first (a snippet,
  a neighbourhood), which a frame edit never rewrites. A frame that names
  none is a list. The view node is read
  from the schema (the whole graph), not from an ontology's projection: how
  a frame is shown is what it means, so a scoped frame keeps a view node
  that is no member. The first edit of a frame with no view node (a view-as
  command, a sort, a filter) makes one — the list's, carrying the edit,
  filed in the Views list — and names it first; every later edit writes
  that node. Its text is empty: it is found from its frame and in the Views
  list, and a text naming its view or its frame would go stale.
- **A store written before view nodes is migrated on purpose**, by the
  write action `views.migrate` (`migrateToViewNodes`), never by opening:
  opening only warns that a root still holds the old
  shapes (`legacyViewShapes`) or `.kb/views` files, and names the action. A
  `#graph-perspective` node becomes a view node: the renderer it named (an
  option ref or its name as text; none, or one kb does not know, was drawn
  in 2D and still is) becomes its `sys.f.view` — the tag marks the old
  shape, so that renderer wins over a view the seed's fill-absent pass put
  beside it — the tag goes and its other tags stay, and every other lens
  prop stays as a param. A node with the old `sys.f.view.*` frame props (and
  no `sys.f.view` of its own) gets a view node, `view.<frame id>`: the view
  its `sys.f.view.mode` named (the list for none, or one kb does not know),
  carrying its other settings as stored and dated as the frame was last
  written, filed at the end of the Views list (at the forest root when a
  store has none), and named first in the frame's `sys.f.views`. When
  `view.<frame id>` is taken, the frame's view node is the first free
  `view.<frame id>.<n>` and the action warns, so no frame is left in the
  old shape. The tag, `sys.f.view.mode`, the unread placement field and its
  options, and `lens.renderer`'s old option children are retired, and a
  `lens.renderer` ref to one of them elsewhere names that renderer's view.
  The root's `.kb/views/*.json` specs are imported as docs views
  ([Materialization](#materialization)) and their files removed once the
  nodes are committed; a spec it cannot read, whose `docs.<name>` a node
  already holds, or whose name another docs view goes by, is named in a
  warning and its file stays. The migration is a pure function of the node
  set and what the action passes in (the specs and the one stamp an
  imported docs view is dated at) — no fresh ids — so two stores migrated
  apart write the same nodes and merge cleanly, and a second run changes
  nothing. It runs over the store port, so the store
  contract holds it for every backend. A view node its host stops naming is
  not deleted with it (GAP [[01M3YM5Y5XYDZ1C7G0PCQ1RMK8]]).
- **Transient views stay out of the graph.** A hover card or a selection
  preview passes its params from code, which the compiler checks; only a
  view someone chose is stored.

#### Layout views

**Windowing is a view type, not a second system** (roadmap decision 12 in
`docs/brainstorms/2026-09-29-kb-genui-canvas-agents/README.md`). The layout
view, `layout.grid` (`@kb/views`' `layout.ts`), arranges panes as splits
and tabs. Shown inside a pane it is a dashboard (generative UI mode B);
opened as the whole screen it is the workspace. It is the one tree either
way, and only the chrome around it differs (DESIGN-UI.md → Panes and
layouts).

- **The params are the tree.** `{root}`, where a layout is tabs
  (`{tabs: [pane, …], active?}`) or a split (`{split: row | column,
  children: [≥2 layouts], sizes?}`). A split inside a row is a column and
  the other way round, so one arrangement has one spelling. `sizes` are
  fractions summing to 1, and are left out when the shares are even. Pane
  ids are unique in the tree and hold no `/`. The schema refuses any other
  shape, and every edit in `layout.ts` (`openBeside`, `closePane`,
  `withPanePath`, `normalizeLayout`) returns a tree it accepts.
- **A pane holds a location.** A pane is `{id, path}`, and its path is a
  kb location that the UI's route table resolves: any page's path, or
  `/node/<id>`, which shows a node in its default view, or
  `/node/<id>/<view>`, which shows it through one of its view nodes or
  through a view type named by its option. The URL names the focused pane
  by being that pane's path. Ephemeral pane state (scroll, selection) is
  not part of a layout.
- **A node opens by one rule** (`resolveNodeView`, the `layout.node` view):
  through a named view type, read for the node from an empty view node;
  through a named view node, read for the node; as the view node itself
  when the node is one; otherwise in the node's default view (the first it
  names) or, when it names none, as the outline rooted at it (`outline.main`
  with `root`). A frame view's page is the outline at the frame, and a
  graph renderer's page is the graph page drawing that view node. The UI's
  links, a pane, a dashboard's panes and `ui.navigate` all open nodes this
  way.
- **A layout node holds its tree as one prop.** `sys.f.layout` holds the
  tree as canonical JSON, the shape a canvas keeps its layout in, so a drag
  writes one prop atomically. "Save workspace" proposes the live
  arrangement through `view.propose`, the one check of a proposed view, so
  the UI saves exactly what an agent could propose. A pane at the zoomed
  outline is saved as the node it is zoomed to. The node is filed in the
  Views list and can be pinned. An agent builds a dashboard the same way,
  from the catalog entry: it can name a host, whose default view it then
  is. The nodes that a layout's panes open live inside that JSON, so the
  loader derives no mention of them (GAP [[01M411FNY9J46BD71N2C5641NB]]).
- **A layout that contains itself stops at the first repeat.** Each pane
  of a dashboard draws its page through a slot shown for its location, and
  the node route draws through a slot shown for the view node, so opening
  a layout inside itself repeats a link that the slot refuses
  (DESIGN-UI.md → the slot's promise 6).

#### Chart views

**A chart is a query node's rows drawn by a Vega-Lite spec** (roadmap
decision 10). The chart view, `chart.vega-lite`, is the chart family's
(`@kb/chart`, [Extension families](#extension-families)): its key, its
spec, the rows it draws, its text and its seed field. It is a projection
like a table: the table lays a query's rows out as cells,
the chart as marks. How the browser draws it is DESIGN-UI.md → Chart views.

- **The params are a source and a spec.** `{source?, spec}`: `source` is
  the query node whose rows the chart draws, stored as `lens.focus`, else
  the node the chart is shown for, so one chart view node named by many
  query nodes draws each, and a proposal with no source is such a template.
  `spec` is a Vega-Lite spec as plain JSON, held as canonical JSON in one
  text prop, `sys.f.chart`, the way a layout holds its tree; a view node
  holding none draws the count of its rows (`starterChartSpec([])`, the
  catalog's default). Settings are JSON, never code, which is why the spec
  is Vega-Lite: TanStack Charts' accessor functions cannot be stored, and
  it may become a renderer behind the same stored spec.
- **The spec is checked for its shape, and holds no data.** `ChartSpec`
  declares Vega-Lite's top-level keys, each checked for its shape (a mark
  Vega-Lite draws, arrays of objects for `layer`, `transform`, …, a
  Vega-Lite `$schema` when it names one), and must draw something (a mark
  or a composition); what lies inside them is Vega-Lite's to read. It holds
  no `data`, `datasets` or `url` anywhere, at any depth: a chart's data is
  its query's rows, and a stored spec fetches nothing. A proposal that
  breaks this is refused at the path (`view.propose`); a stored one that
  breaks it does not decode, so it is never drawn. The catalog publishes the
  shape as JSON Schema, `additionalProperties: false`, with no `data` key.
- **The rows are records named by the query.** `@kb/query`'s
  `queryRecords` makes each row an object keyed by the query's `:find`
  names (`?status` is `status`, `(count ?n)` is `count_n`, a repeat gets
  `_2`), read from the `:find` section alone, so a query outside the IR
  subset is named too; columns it cannot name are `col_1`, `col_2`, ….
  The query's limit caps them, and `chartRecords` caps every chart at
  `MAX_CHART_ROWS` (5000) whatever its limit. `chartSpecWithData` makes them the spec's
  data (`data.values`, named `CHART_DATA` so a host swaps new rows in) and
  fits a spec that fills its box (one view or a layer, unsized:
  `fillsChartBox`) to the box it is drawn in. These are the only data a
  chart draws, on every surface.
- **On a text surface a chart is its encoding and its data.** Its body
  (`viewText`, View nodes above) is what it draws — mark and channels,
  layer by layer (`describeChartSpec`) — then its rows as a markdown table,
  or why it has none: no source, a source that is no query node, a query
  that fails. On an html page (`render.view` as html, a `ui://kb/view/<id>`
  snapshot) its SVG sits above that text, drawn in a fixed 560 × 300 box
  by a `ChartPainter` (`@kb/chart`): it draws a Vega-Lite spec with inline
  data as one SVG document, fetching nothing and compiling no code. The
  painter is handed to the family's shared plugin by the host's entry
  (`chartPlugin({painter})`): the server's, `chartServerPlugin`
  (`@kb/chart-vega`), hands it Vega, headless under Bun with no canvas,
  whose tests hold the promise; the page's hands it none, so the browser's
  isomorphic actions draw the text alone. The snapshot is unthemed, Vega's
  own look, like the page around it.
- **How kb runs Vega is one place, `@kb/chart-vega`.** A Vega-Lite spec compiles
  to Vega, parsed to an AST (`ast: true`) that `vega-interpreter`
  evaluates, so no expression in a stored spec becomes `new Function` and a
  strict CSP holds; the loader refuses every load, sanitize, http and file
  request (`NO_NETWORK`), so a URL that slipped past the check, an image or
  a link reaches nothing. The browser and the server both run specs
  through it.
- **A chart view node is written like any view node.** An agent proposes
  one through `view.propose` from the catalog entry; the UI's "Add chart"
  proposes one for a query node, and its spec editor writes `sys.f.chart`
  through the same check. Like every view node, one written through
  `node.update` is not checked (GAP [[01M40X308W34T0PGSN12S9K2K2]]).

#### Code views

**A code view is code that draws something, as a view node's settings**
(generative UI mode C, roadmap decisions 4 and 5). The code view,
`code.view`, is the code family's (`@kb/code`,
[Extension families](#extension-families)): its key, its settings, its
text, its page's snapshot and its two seed fields. It runs in the sandbox
([Sandbox](#sandbox)), which is core.

- **The params are a source, the code and a grant.** `{source?, code,
  grant}`: the code is one text prop, `sys.f.code`, held and read
  untrimmed, because what runs is what a person trusts; the grant
  (`{reads, actions}`, [Sandbox → Grants](#grants-and-the-script-actor)) is
  canonical JSON in `sys.f.code.grant`, absent meaning the default (read the
  subject, call nothing); `source` is `lens.focus`, else the node the view
  is shown for, and the code reads it as `kb.subject`. A view node holding
  no code runs `STARTER_CODE`, which lists its subject's children.
- **Agents write code views through `view.propose`**, from the catalog
  entry, whose description is the guest's whole API. Like every view node,
  one written through `node.update` is not checked
  (GAP [[01M40X308W34T0PGSN12S9K2K2]]).
- **On a text surface it is shown, not run**: where it runs, what its grant
  lets it ask, and its code in a fence no backtick in it can close. On a
  page it is that text under what the code draws as of the render
  ([Sandbox → Snapshots](#snapshots)).

## Storage (horizontal)

The port is `EffectStore` in `packages/contract/contracts/src/store.ts`; that
file is its canonical statement and this section does not restate its members.
What matters here is that there are **two adapters behind it**, that the choice
between them is a fact about the tree rather than a setting, and that
everything above the port — operations, query, surfaces — sees only
`EffectStore` + `KbNode`.

Both adapters answer the same three questions and are proven by the same
tests: `storeContract(name, makeStore)` in `@kb/test-kit` is one `describe`
block that each adapter's test file calls with its own factory. A property
that holds for one backend and not the other is not a store property, and the
contract is where that gets found out. The contract also holds what a session
over the port promises because of it — opening is a read, and a node created
without a rank gets one and keeps it — since a session guarantee that held on
one backend alone would be that backend's property.

A commit settles sibling ranks before it writes ([Sibling ranks](#sibling-ranks)).
That is a port promise, not an adapter habit: each adapter runs `rankTx` inside
its exclusion and reports the result as `StoreCommit.tx`, which is what the
tail records and what a session's index applies.

`storeBenchmark(name, makeStore)` sits beside it and is measured the same way:
the 50k-node first write, cold load, datom build, query, `kb set`-shaped commit
and interactive edit, printed and never asserted on — measured gates belong to
Phase 4. Its phases are port-level, so the two adapters produce two columns of
one table instead of two tables. The JSONL adapter's old read-versus-decode
split went with that: it was measuring two halves of `JsonlStore.loadEffect`,
which the port does not have. `briefs/p1-persistence.md` picks incremental
reading up against that adapter's own internals when it gets there; keeping
`decodeNodes` exported for a benchmark nobody runs yet would be a dead seam.

A tool outside kb's surfaces reaches the graph through `@kb/client`
(`packages/app/client/README.md`): a fresh read, a query over it, and a commit
conditioned on the fingerprint that read returned — the port's own members,
behind a Promise boundary, with no second notion of revision. It opens
whichever store `selectStore` finds, like every other surface.

The candidate second backends are **not** an open field:
`briefs/p1-persistence.md` §0 is the canonical record of what was measured and
rejected (Logseq's own fork — opaque Transit blobs, and their answer to git is
"export markdown" — plus Cozo, Kuzu, Mentat, Datahike/XTDB, the server-backed
graph databases, and the CRDT stores). Of those, `bun:sqlite` is the one that
survived, and it survives twice over: as the store below, and — still
unbuilt — as a derived, gitignored, deletable **index** that is never
authoritative. Those are different things wearing the same library; the store
is authoritative and committed, the index would not be.

### JsonlStore — `.kb/nodes.jsonl`

One canonical-JSON node per line, sorted by id, sorted keys → stable bytes,
mergeable diffs. This is the adapter a repo gets by default, because a text
file is the format git already understands.

- **Performance is a stated requirement**, and what the code does today is:
  read the whole file into one string, split on newlines, decode each line
  through `Schema`; single-pass datom build; durable whole-file replace
  (below). Incremental file reading is a target owned by
  `briefs/p1-persistence.md`, not a description of the current implementation.
  `.bak`, `nodes.jsonl.lock`, `nodes.jsonl.*.tmp`, and `.kb/cache/` are
  gitignored — only the live `nodes.jsonl` is committed.
- **Write hardening** (r4 Stage-0 — on-disk format unchanged), two modules
  in `@kb/store-jsonl`:
  - `write-lock.ts` — an exclusive `.kb/nodes.jsonl.lock` carrying the holder
    pid wraps the _whole_ commit via `Effect.acquireRelease` inside
    `Effect.scoped`, so reload → merge → replace is one critical section and
    concurrent CLI / MCP / `kb ui` writers cannot silently clobber each other
    (previously last-writer-wins). Contention spins on `Effect.sleep`
    (25ms, `MAX_WAIT_MS` 15s — never a loop-blocking sleep); a lock whose
    recorded pid is dead is stolen, and only exhausting the ceiling fails,
    with a `conflict` error naming the holder pid.
  - `durable-replace.ts` — write the candidate to a tmp fd + `fsync`, copy the
    live file to `nodes.jsonl.bak` (+fsync), `rename` tmp → live, best-effort
    parent-directory fsync. Ordering-safe; **not** crash-injection tested
    (no `F_FULLFSYNC`). A conditional commit is checked under the same
    lock, against the fingerprint of the bytes it is about to merge into.
- **Load is all-or-nothing**: a malformed or schema-invalid line fails the load
  with a line-numbered error and returns no nodes; load never rewrites the file
  (same fail-closed posture as the pre-Schema `JSON.parse` loader). Unknown own
  JSON properties on otherwise-valid nodes are preserved across decode so a later
  commit cannot silently drop them.
- **Fingerprint is the SHA-256 of the file's bytes** (`content-mark.ts`). The
  question is about content, so the answer is too: a same-length write inside
  one mtime tick — invisible to the size+mtime stat this used to be — moves it,
  and so does any byte a decoder would ignore. A missing file is the empty
  store and carries the empty store's mark; a file that cannot be read has
  none. Load and commit both start from one read, so the `base` a commit
  reports names exactly the bytes it merged into. The cost is a hash where a
  stat was: measured by the store benchmark at roughly +10% on a 50k-node
  commit, and noise at this repo's size.

### SqliteStore — `.kb/kb.sqlite`

`@kb/store-sqlite` over `bun:sqlite`. Same nodes, same canonical JSON, a
different container.

```sql
CREATE TABLE nodes (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE meta  (key TEXT PRIMARY KEY, value TEXT);   -- schema_version, rev
-- plus nodes_rev_{insert,update,delete}: AFTER triggers that bump meta.rev
```

- `body` is **the same `canonicalJson(node)` string the JSONL writes**, one row
  per node instead of one line per node. Not a column per field: the row is a
  node's bytes, and the only thing the store promises is to give them back. A
  column per field would be a second, partial copy of the node schema living in
  DDL — the exact mirror Rule 1 forbids — and it would have to grow every time
  the model does. `id` is the primary key because it is the identity the model
  already has.
- **Decode is the JSONL decoder.** `decodeStoredNode` lives in `@kb/model`
  beside `KbNodeSchema` and `nodeParseOptions`, and both adapters call it; the
  JSONL loader adds line numbers, the sqlite loader adds the row id. "How a
  stored node becomes a `KbNode`" is one function, so unknown-key preservation
  and correlated `PropValue` validation cannot drift between backends. Load is
  all-or-nothing here too: one bad row fails the whole load with an
  `invalid_input` naming that row's id.
- `.kb/kb.sqlite` is the committed file, the way `nodes.jsonl` is; `-wal` and
  `-shm` are derived and gitignored.
- `PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 15000`.
  WAL so a reader is never blocked by the writer; `NORMAL` because the same
  durability trade the JSONL adapter makes (ordering-safe, no `F_FULLFSYNC`) is
  the honest one at repo scale; the busy timeout is the same 15s ceiling
  `write-lock.ts` already spends waiting, so a contended commit behaves the same
  on both adapters rather than failing fast on one and spinning on the other.
- **No `.lock` file.** `BEGIN IMMEDIATE … COMMIT` takes sqlite's own write lock
  for the whole deletes → upserts → tail-record transaction. A second lock beside
  it would be two mechanisms for one concept, and the weaker one would be the
  one that lies.
- **Fingerprint is `meta.rev`, and the database keeps it.** Triggers on
  `nodes` (one per insert, update and delete; schema 3) bump it, so it moves for
  every writer — this store, another process, a hand-run `sqlite3` — and on
  every commit that touches a row, including one whose content is
  byte-identical to what was there, where JSONL's content hash deliberately
  does not. It is also the tail's `mark`: one name for the state, as on JSONL.
  The database keeps it rather than the store because the name must be the
  state's, not the reader's — the store contract asserts that every instance
  over a root gives one state one name, which is what lets a revision read in
  one process condition a commit in another. `PRAGMA data_version`, the other
  way to see a foreign writer, is a per-connection counter and fails exactly
  that. Null when the file does not exist, so an
  unopened store compares equal to nothing.
- **The store owns the connection.** It opens lazily on first `load` or
  `commit` and stays open for the store's lifetime; `close()` exists for tests.
  The caller cannot own it: `EffectStore` is constructed once per session and
  handed to layers, actions and the watcher as a value, and none of them has a
  lifetime to hang a connection off — `KbContext` is not scoped. Making the
  connection the caller's problem would push a resource into every host that
  today constructs a store and forgets about it, to buy nothing: one process,
  one session, one connection.

### Choosing an adapter — presence, not configuration

`selectStore(root)` in `@kb/runtime` (the one composition root) answers by
looking:

| `.kb/kb.sqlite` | `.kb/nodes.jsonl` | store                         |
| --------------- | ----------------- | ----------------------------- |
| absent          | either            | `JsonlStore`                  |
| present         | absent            | `SqliteStore`                 |
| present         | present           | `conflict`, naming both paths |

Presence rather than a config key because there is nothing else to configure —
the answer is a single bit, the file that holds the data is the least
surprising place to keep it, and a config file that disagreed with the tree
would be a second source of truth for which store is real. Both present is an
error rather than a precedence rule: a precedence rule would silently pick one
and leave the other's writes stranded, which is the failure mode worth being
loud about. The code is `conflict` — two stores claiming the same root is
exactly that — because `DomainError` has no `invalid_state`, and inventing one
would widen `FailureCode`, the receipt mapping and the wire protocol for a
single call site.

### The store announces its own changes

Noticing that another writer moved the store is a store property, like
reading and committing, so it is a member of the port: `EffectStore.changes`,
a stream of fingerprints. What it promises, for every adapter:

- **Armed, then news.** The first element is the current fingerprint, once the
  subscription is live; every later element is a fingerprint that differs from
  the one before it. A consumer that reconciles on the first element misses
  nothing that landed before it subscribed.
- **Another writer is announced unasked, within a bound.** A commit by any
  other instance over the same root — another process, a hand edit — appears
  within `STORE_CHANGES_POLL` (`@kb/contracts`, one second) plus one sample.
- **States, not writers; deduplicated.** One state is announced once, however
  many platform events it took. This instance's own commits are announced too
  when the platform reports them; a consumer treats that as a no-op, because
  its commit already returned a `StoreCommit` and the session's fingerprint
  memory (`reloadEffect`) recognises the state.

`storeContract` proves all three against every adapter, with a second
instance over the same root standing in for the other process;
`app/server/tests/cross-process-sync.test.ts` proves the same end to end,
with a real second process, `kb ui` and a WS frame.

Both file-backed adapters get `changes` from one function,
`fingerprintChanges` (`@kb/contracts`), and differ only in the directory they
name and the fingerprint they sample. Both halves of what it does are there
because a platform cannot be trusted to say what changed:

- **Watch directories, not names.** A watch on the file is stranded by the
  atomic replace, and the name a directory event carries is not the file that
  changed: macOS reports a rename under its source name, so the `tmp` →
  `nodes.jsonl` replace that ends every JSONL commit arrives as the temp file,
  and a burst coalesces to one name the platform picked (for sqlite, usually
  `-shm`). An event means only "sample now", and the fingerprint decides.
- **Poll as the bound.** A write through a file descriptor that stays open
  produces no event at all, which is how a long-lived sqlite connection writes
  its WAL. Events keep the common case prompt; the poll keeps the promise.

The consumer never names a file: the `kb ui` server runs the stream and
ingests each element.

### Migrating between adapters

`kb store migrate --to <jsonl|sqlite>`: load every node from the store that is
present, commit them into the other, then delete the source's files
(`nodes.jsonl` + `.bak`, or `kb.sqlite` + `-wal`/`-shm`) so that presence stays
unambiguous the moment the command returns. It refuses when the target already
exists — that is the "both present" state the selector rejects, and the
migration is not entitled to resolve it.

It is a CLI command in `@kb/cli`, not an action in `@kb/operations`, and the
reason is structural rather than a preference: `@kb/operations` is
`scope:shared` and sits in the `application` layer, so it may import neither
`bun:`/`node:` nor an infrastructure package. Migration is defined by
constructing _both concrete adapters_ and deleting _their_ files; written
against `EffectStore` alone it cannot name a single one of those things. The
one place that legitimately knows both adapters exist is the composition root,
so `migrateStore` lives beside `selectStore` in `@kb/runtime` and the CLI
command is a thin surface over it.

### The transaction tail — the store records what changed, in order

`KbTxLog` (`contracts/src/tx-log.ts`) is the one producer of "what changed, in
order". Its _sequence_ is not in the log: it is `EffectStore.txTail`, a
`TxTail` the store owns. That is where it has to be, because the node write and
the record have to be one act, and only the store is inside the exclusion that
makes them one. The log is the session's **view** of that tail — the head it
has caught up to, the subscribers it notifies, and two ways a transaction
enters the sequence:

- `refresh()` adopts whatever the tail gained past head. That is how a
  session's own commit is recorded (the store appended it inside
  `commitEffect`) _and_ how another process's commit arrives — the tail is
  shared, so a CLI write is already in it when `changes` announces it, and reading
  it beats re-deriving it by diffing node sets.
- `append(ops, at, origin)` records a transaction the store did _not_ commit.
  There is exactly one: the saved-query virtual set (below). The
  hand-edited-file fallback uses it too, because no transaction was ever
  recorded for that write.

`StoreTxLog` holds **no window**. The bounded in-process ring it replaces
existed only because there was nothing durable to read; keeping it beside a
durable tail would be two records of one sequence, and the shorter one would be
the one that answered `snapshot-required` first. `rev` is therefore the
**store's** counter, durable across a restart — `protocol.ts` says so — so a
client that reconnects after `kb ui` restarts is caught up with frames instead
of refetching the graph.

**The two tails.**

|        | tail                                               | atomic with the node write?      | rev allocation                                                                    |
| ------ | -------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| JSONL  | `.kb/tx.jsonl`, one canonical-JSON record per line | no — two files, one lock         | under `.kb/nodes.jsonl.lock`, the lock that already covers load → merge → replace |
| SQLite | a `tx` table in `.kb/kb.sqlite`                    | yes — the same `BEGIN IMMEDIATE` | inside that transaction                                                           |

Both records carry `mark`: the store's own durable commit mark as of that
append (`nodes.jsonl`'s content hash; sqlite's `meta.rev`) — on both, the
store's fingerprint. `TxTail.isCurrent()`
compares the newest mark to the store's current one, which is what makes the
next paragraph a detection rather than a hope.

**Write order: nodes first, tail second.** It only matters for JSONL, where
the two writes are two files. The order is not symmetric in cost:

- a tail that **lags** costs one snapshot. `isCurrent()` returns false at open,
  `StoreTxLog` sets its `floor` to `head + 1`, and every `since(rev ≤ head)`
  answers `"snapshot-required"` — including a client that is _at_ head, which
  is the case a naive implementation gets wrong.
- a tail that **led** would hand every replica a frame for a write that never
  landed, and no later frame could take it back.

So the tail is allowed to be behind and never allowed to be ahead. The same
detection covers a store written by something that recorded nothing at all — a
hand-edited `nodes.jsonl`, a restore from backup, an older kb. For the same
reason the tail append is deliberately **not** `fsync`ed while the node write
is: skipping the flush can only widen the lag, which is already handled, and
paying an `fsync` per commit to shrink a window nothing falls into would double
the cost of every keystroke. JSONL's mark is the store fingerprint, so a lag is
detected exactly.

**Compaction.** Both tails keep their newest 2048 records and drop to 1024 when
they pass it — the bound the ring used to impose, moved to the file so an
unbounded sequence costs one rewrite instead of unbounded disk. A reader
further behind than the tail reaches gets `"snapshot-required"`, which is the
answer the port already had.

**Rev allocation is the store's exclusion, not a second lock.** `TxTail` reads
its own head to assign the next rev, so it is not self-serialising: the store
appends inside the lock that already serialises writers, and the only other
appender is the saved-query set in the single `kb ui` process that owns
`.kb/queries/`.

**Migration carries the tail.** `kb store migrate --to` reads the source tail,
commits the nodes, then `adopt`s those records into the target — revs
preserved, marks re-stamped to the target (the source marks describe a store
that is about to be deleted). A migration changes nothing a client can see, so
it must not be the thing that forces every client into a snapshot. A source
with no tail leaves the target the one record its own migration commit made,
which is the truthful answer: the whole graph arrived in one transaction and
nothing before it is known.

**One contract test.** `logContract(name, adapter)` in `@kb/test-kit`, beside
`storeContract`, run by both adapters: the empty tail, a commit's record, rev
across a reopen, `since` from a durable tail, `since` beyond head, an empty
commit recording nothing, a failed append leaving head unchanged, a store ahead
of its tail detected, a stale tail refusing frames, and a virtual transaction
recorded without touching the nodes. Two of those need a state that is only
reachable past the port — the tail one record behind, and a tail that refuses
writes — so `LogAdapter` carries the one line that injects each (a line off the
file / a row out of the table; a chmod / an aborting trigger), the way `s1`
left the mid-write abort in the sqlite package.

**Saved queries are a logged transaction.** `savedQueryNodes()` materialises
`.kb/queries/*.edn` as `sys.query.*` nodes that answer queries and never reach
the store. They used to be handed to the hub once at construction and never
appear in a frame, so a client catching up with `since` ended with a graph a
fresh snapshot disagreed with. `SavedQuerySet` (`app/server`) owns the set now:
`adopt` installs the first one (the snapshot carries it, so logging it would
spend a rev saying what the client already has) and `sync` diffs and appends
with `origin: "virtual"`. `.kb/queries/` is watched with the same
`directorySignals` the store's `changes` is built on, and ingested through the
same lane. One path to a client, whatever a node's provenance.

### What is still true of both

- No leases. The JSONL lock is advisory, filesystem-local and process-scoped;
  sqlite's is real but equally process-local. Either serializes writers; neither
  makes a _reader's_ snapshot binding. Conditional writes (an `expect`
  precondition carrying graph identity / node hash, returning the existing
  `conflict` receipt) are designed in
  `docs/kb/waves/2026-08-23/reports/r8-zerolang.md` §1 and **parked** — no
  action input accepts `expect` today.
- The index is `DatascriptIndex` in memory on both, and the transaction log is
  `StoreTxLog` over the store's own tail on both — durable on both, and the one
  thing sqlite buys there is atomicity with the node write rather than an
  ordering argument. An SQL-backed `KbIndex` still needs an IR → SQL compiler
  and is still a gap.

## Query layer (horizontal)

- `datascript` npm. Every load rebuilds a DataScript database from the current
  nodes, then queries that value.
- `kb query '<edn datalog>'` for raw power; pull API via `kb get <id> --depth N`.
- **One parser, one compiler.** Every datalog surface — `kb query`, `kb run`,
  MCP `graph_query`, `#query` nodes over `/ws`, the UI's `@/ds` seam — hands
  its EDN to `KbIndex.runDatalog`, which is `compile(parseEdn(edn))` then
  DataScript. The subset `parseEdn` understands becomes the kb IR
  (`@kb/query`'s `ir.ts`); anything else passes through as `raw`, unchanged.
- **A number stays a number when the query parses.** A ref prop and a number
  prop are both stored as a bare number (GAP [[01M3A0Y5JQ5XKZMC87K34HDT2B]]),
  so a result value that equals a live eid could be either. For a query in
  the IR subset only node-ref find positions are revived into node ids: a
  variable the IR types as a node, or one bound as the value of a field attr
  that holds refs somewhere in the data (the index's `refAttrs`). A count or
  a number field's value stays a number. A `raw` query revives every
  eid-shaped integer, as it cannot tell them apart.
- **Transitive reach** is a `:where` clause in that subset, written as a rule
  call so the EDN stays valid datalog:

  ```clojure
  (reach ?from <edge> ?to)           ; 1..∞ hops — no cap
  (reach ?from <edge> ?to <max>)     ; 1..max hops, max a positive integer
  ```

  `<edge>` is any node-valued attribute: `:node/mentions` (the reference
  relation, either carrier), `:node/child`, or `:f/<fieldId>` for a ref field.
  A list headed `reach` with a keyword in the edge slot is this form. If it is
  malformed (an end that is not a variable, a bound that is not a positive
  integer, extra arguments) in a query the subset otherwise covers, that is a
  `DatalogError` naming `reach` (`invalid_input`), not a `raw` fallback. In a
  query that is `raw` anyway (below), it is raw like the rest. Without the
  keyword it is an ordinary rule call.
  `?from` and `?to` are variables, and either end may be the bound one:
  `(reach ?me :f/parent ?anc)` walks up a lineage, `(reach ?d :f/parent ?me)`
  walks down it. Each step and each result is a node: a dangling ref (kept
  as its id string, see Data model), a string, a bool or a number that is
  not an eid is neither followed nor returned. A number that equals a live
  eid is indistinguishable from a ref to that node in the datoms
  (GAP [[01M3A0Y5JQ5XKZMC87K34HDT2B]]). A
  cycle terminates, because the unbounded form is a set fixpoint and the
  bounded form counts hops. The compiler owns the recursive rules it emits
  (private `__kb_reach_<n>` names, so a caller's own rule cannot collide):
  `%` is added to `:in` when the query does not declare it, and when it does,
  the emitted rules are appended to the rules string the caller passes there.
  The engine is DataScript's recursive-rule evaluation, which is superlinear
  in path length; a lineage of hundreds of hops is seconds, not milliseconds.
  Path reconstruction and a minimum hop count are not in the form: a path is
  not a datalog relation, and a hop counter on the unbounded form would not
  terminate on a cycle. `reach` is recognised only in a query the subset
  covers whole; one construct outside it (a predicate, `not`/`or`, `_`,
  `:with`) makes the query `raw`, well-formed or malformed `reach` included,
  and there `reach` is an ordinary rule call that no rules define
  (GAP [[01M39X8RPQBWFVDNG77BB3ZCMH]]).

  ```bash
  kb query '[:find ?id :where [?r :node/id "n.root-a"] (reach ?r :node/mentions ?n) [?n :node/id ?id]]'
  ```

- Query failures are typed at the action boundary: errors thrown by the
  datascript engine on the caller's EDN become `DatalogError`
  (→ `invalid_input`); defects in our own glue (normalization / result
  revival) stay plain `Error` (→ `internal`) so internal bugs are never
  hidden behind "invalid datalog".
- **Saved queries are data, not code** (portability): `.kb/queries/*.edn`
  files, run via `kb run <name>` or the first-class `graph.run` action.
  The tool stays generic; repo-specific
  queries travel with the repo's data dir. Any repo adopting `kb` brings its
  own `.kb/queries/`. Shell-script wrappers optional on top, zero baked-in.
- Built-in shorthands limited to structural ones: `kb backlinks <id>`,
  `kb children <id>`, `kb search <text>` — `kb search` delegates to the
  first-class `graph.search` action (case-insensitive substring over node
  text), so the substring policy lives in the action, not the CLI.

## Ontologies — a lens over the graph

An **ontology** is an ordinary node tagged `#ontology` that names a subset of
the graph. It is a new node _kind_, not a new node _type_: nothing in the data
model changes, and membership bookkeeping lives on the ontology, never on the
member — a node that never joins one carries zero ontology props. Full design
(including the parts deliberately left out) is
`docs/kb/waves/2026-08-23/reports/r5-ontology.md`.

Six seeded fields carry the definition, all templated by the `#ontology` tag:

| Field                | Type                                               | Means                                              |
| -------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `sys.f.onto.include` | ref (→ `sys.tag`), multi                           | tags whose instances are members                   |
| `sys.f.onto.member`  | ref, multi                                         | explicit pins                                      |
| `sys.f.onto.exclude` | ref, multi                                         | vetoed nodes — absolute                            |
| `sys.f.onto.extends` | ref (→ `#ontology` via `sys.f.targetQuery`), multi | parent ontologies whose members are inherited      |
| `sys.f.onto.query`   | text                                               | parameter-free EDN datalog; first column = node id |
| `sys.f.onto.closure` | text: `none` (default) \| `descendants`            | structural pull of members' subtrees               |

**Membership algebra — core is union + veto:**

```
members(O) =  ⋃ members(P)  for P ∈ O.extends      -- inheritance
           ∪  { n | ∃t ∈ O.include . n tagged t }  -- supertag sets
           ∪  O.member                             -- explicit pins
           ∪  ids(run(O.query))                    -- query-defined
           ⊕  closure(O.closure)                   -- structural pull
           ∖  O.exclude                            -- absolute veto
           ∖  { O } ∪ extends-ancestors(O)         -- definitions never members
```

Precedence is the whole rule a human has to remember: **union everything, then
subtract**. `exclude` is applied last and beats tag-, pin-, query-, extends-
and closure-derived membership, which is what makes "remove this from my
ontology" always work. Set algebra _over_ ontologies (`intersect` / `subtract`,
so "Infrastructure ∩ Open work" would itself be a node) is specified in r5 §1.2
and is out of core — the resolver signature leaves them as extra passes rather
than a rewrite.

**Nothing graph-shaped throws.** `extends` is a DAG by intent and cycle-safe by
implementation: DFS with a `visiting` set, back-edges ignored _and reported_,
depth capped at 32 (`DEFAULT_MAX_DEPTH`). Cycles, malformed EDN, unknown refs,
a missing query runner, and the soft size cap (`DEFAULT_WARN_ABOVE` = 5000
members) all surface as `warnings` on the resolution instead of failing it —
a broken definition must never make a page unopenable. Same posture as
`buildTreeForest` in the graph lens.

**One resolver, three surfaces.** `@kb/model`'s `ontology.ts` is pure and
isomorphic — no Node/Bun API, no `datascript` import; the EDN runner is
_injected_. CLI and MCP pass `@kb/query`, the browser passes its own
`ds/query`, both reaching the same module through the `@kb/ontology` alias, so
there is no fork (contrast `ds/datoms.ts`). Resolution is deterministic
(input node order, then prop order) and carries per-member provenance —
`reasons: MemberReason[]` with `kind: "member" | "tag" | "query" | "extends" |
"closure"` and an optional `via` — which is what the Members list renders.

**Surface.** `ontology.members` (read) is the only registry action the feature
adds: everything mutating is already expressible as `node.add` / `node.update`,
and the resolver is the one thing not expressible as a single datalog query.
CLI sugar:

```bash
kb ontology list                        # #ontology nodes
kb ontology members <id> --reasons      # members + provenance + excluded + warnings

# defining one is plain node.update; the onto.* fields are declared ref, so
# the argument is written as a ref to that node.
kb set <onto> onto.include <tagId>
kb set <onto> onto.member  <nodeId>
kb set <onto> onto.exclude <nodeId>
```

So the UI's scope is _exactly_ reachable through data — the standing rule in
INSPIRATIONS.md ("anything the UI can do must be reachable through data").

**Scoped reading mode** is the UI consumption of the same resolver and is
specified in DESIGN-UI.md. The one invariant that belongs here: scope is a
**projection over the wire snapshot, not a sandbox** — the query db stays built
over the full graph, so backlinks, `#query` nodes, and WS subscriptions keep
honest reach while the outline/graph/search render members only.

Parked by design (r5 §2.9, none of it in core): an ontology's _schema_
vocabulary (which fields members carry) and _relation_ vocabulary (which
ref-fields count as internal edges), inference, auto-classification, validation
enforcement, tag inheritance, and auto-admission of nodes created inside a
scope.

## Action registry

Harman-lite (zod) + Effect-native handlers for owned actions:

- `ActionDefinition { id, title, description, mode, inputSchema, outputSchema, effect? }` — JSON Schemas via `z.toJSONSchema`, never hand-written; the inputSchema is published as the side a caller sends, the outputSchema as the side the action returns. Optional `effect` is the Effect-native handler seam for built-ins / bundled extensions.
- **Mode**: every action states once, as a required field, what invoking it does.
  `{kind: "read"}` changes nothing. `{kind: "write", approval?: "required"}`
  may change the graph, the workspace, or what a UI tab shows
  ([Screen state](#screen-state)). Approval can only be declared on a
  write, so there is no read-with-approval state. The manifest publishes the
  mode, and each surface derives its behaviour from it and keeps no list of
  its own:
  - MCP: a read is `readOnlyHint` and `idempotentHint`; a write is
    `destructiveHint`; every tool is `openWorldHint: false` (an action
    touches only its kb root). Hints cannot express approval, and a tool name cannot
    be mapped back to an id, so every tool also carries `{id, mode}` under
    `_meta["kb/action"]`.
  - WebMCP: a read is `readOnlyHint`, a write is `consequentialHint`
    ([Surfaces](#surfaces)).
  - `kb ext list` prints the mode.
  - The browser answers a local read without pushing it (DESIGN-UI.md →
    Architecture, Mutations). Where an action runs, locally or on the
    server, depends on what its handler needs, not on its mode.
- **Approval** is decided in one place, the invoke core (`invokeWith`), by one
  resolver, `resolveApproval` in `@kb/contracts`, before anything runs
  (roadmap decision 13 in
  `docs/brainstorms/2026-09-29-kb-genui-canvas-agents/README.md`). What it
  decides about a call is `allow`, `ask` or `deny`. A denied call fails
  `forbidden`. A call that asks runs only with a person behind it, and
  otherwise fails `approval_required`. Both refusals name the deciding
  policy in `details.policy`.
  - **Policies are nodes.** An `#approval-policy` node (`sys.tag.approval-policy`)
    has `approval.match` (an action id, a pattern where `*` is any run of
    characters such as `ext.*`, or a mode word, `every read` or
    `every write`), `approval.actor` (one of its option children `human`,
    `agent`, `cli`, `script`; absent means every actor) and `approval.decision` (one of
    `allow`, `ask`, `deny`). The tag, the fields and the options are seeded,
    and a policy names an option by id, so renaming one changes nothing. A
    policy missing its match or its decision decides nothing.
  - **The most specific policy wins.** A policy applies when its match names
    the action and its actor is the call's or absent. Specificity is ordered
    by match first: the action's own id, then a pattern by how many literal
    characters it holds, then a mode word, then a bare `*`. Then a policy
    naming the actor beats one naming none. Two policies that still tie
    decide the stricter, so order never matters. With none, the action's
    declared mode decides (decision 3): `ask` where it requires approval,
    else `allow`.
  - **A declared approval is a floor that only a policy naming the action by
    its own id can lower.** Its author said every call needs a person. A
    pattern or a mode word is written for many actions and must not unsay
    that by accident, while a person who names the one action means it.
    Any policy may raise a decision.
  - **A person stands behind a call** when it carries `approved: true` or its
    actor is `human`. A gesture is the person, so a human is never asked:
    the owner's "a human gesture never asks" holds in the resolver, not as a
    policy row that could be edited into a confirm the UI has no way to show.
    A policy can still deny a human.
  - **Writing a policy always asks**, whatever the policies say, so no caller
    can allow itself. A write counts when it writes an `#approval-policy`
    node (tagged before or after, so tagging and untagging count) or the
    tag, the fields and the options policies are written in; a denial stays
    a denial. This is a rule of the resolver, which weighs the call's writes
    as part of the call (`ApprovalCall.writes`): the invoke core asks it
    before the handler runs, and `persistEffect` asks it again with what the
    commit writes and refuses with `approval_required`
    (`details.writes: "approval-policy"`) before the store is touched. So a
    human edits the policies table directly, while an agent's edit reaches
    the sidebar's approval card and MCP, WebMCP and an unapproved CLI call
    are refused. Every core write commits through `persistEffect`; a
    third-party extension's Promise handler that commits through the store
    port itself is trusted repo code and is not asked.
  - **Seeded defaults**, ordinary editable nodes filed under the query node
    `approval.policies` ("Approval policies"): an agent, and sandboxed code,
    asks before `node.delete` and before `views.migrate`, and neither may
    `sandbox.trust` ([Sandbox](#trust)). An agent asks before
    `extension.switch`, and sandboxed code may not call it, since it changes
    which code the server loads ([Extension families](#extension-families)).
    Normal edits need no row,
    because no core write declares approval.
  - **Policies are managed in a saved table, pinned in the sidebar; there is
    no settings page.** The query node lists every `#approval-policy` node
    wherever it is filed, and names a seeded table view node
    (`view.approval.policies`, filed in the Views list) whose columns are
    the three fields. The Pinned list's seeded reference
    (`pin.approval.policies`) puts it in the sidebar. All three are
    ordinary user-editable nodes, edited like any query, view or pin. A
    seeded node its owner deletes comes back on the next open, because the
    seed adds every id it misses (`// GAP [[01M413SPC35K20DFC4TRP4DJYH]]` in
    `seed.ts`): to retire a default policy, set its decision rather than
    delete it.
  - The policies are read from the session's own graph, once per index
    generation, so a policy written a moment ago decides the next call, and
    the browser's replica decides a local call exactly as the server does.
  - The flag goes on the invocation envelope, not in the input, so a surface
    can carry approval only if its wire format has an envelope.
    `POST /api/action` and `kb action-invoke` do. An MCP tool call and a
    WebMCP `execute` do not, because their arguments are the input, so a
    call that asks is always refused over MCP and WebMCP.
  - The wire also names its **actor**, who a call on it is made by: `human`
    (a gesture in the UI), `agent` (the sidebar agent, MCP, WebMCP), `cli`,
    or `script` (code in the sandbox, [Sandbox](#sandbox)). The actor rides the envelope beside `approved` and is declared
    the same way, not proven. Every surface hands the invoke core its calls
    through `onWire`, which fills in the wire's actor where the envelope
    names none, so only a wire with an envelope (HTTP, `kb action-invoke`)
    lets a caller say otherwise. HTTP's own actor is `agent`, the more
    cautious one, because the page names its gestures `human` and a local
    program that does not say is not taken for a person. A call made in
    process names no actor and meets only the policies for every actor.
  - **Listings are honest.** Each surface declares what its wire carries
    once, as a `SurfaceWire` (`MCP_WIRE`, `HTTP_WIRE`, …), and lists by
    calling `kb.manifest` on that wire. `kb.manifest` lists every action and
    says of each what is decided about the caller's own call
    (`decision`). One rule in `@kb/contracts`, `listedOn`, then leaves out an
    action whose call could never succeed there: one denied to the wire's
    actor, or one that asks on a wire that cannot carry approval
    (`listingOf`). A call by its id or tool name still reaches the invoke
    core and is refused. MCP's `tools/list` and each agent turn read it
    afresh, and the page's WebMCP lists again when its replica's policies
    change.
  - `approved` and the actor are things the caller declares, not a security
    boundary. Policies prevent accidents, not a determined local caller.
    kb has no way to check that a person really approved the call, or who
    made it (`// GAP [[01M413SP3QSSQJMKKDK3W3J6G8]]` in `approval.ts`). The gate
    means only that a caller must say so deliberately and cannot end up
    approving by accident. Anyone who can reach a surface that carries the
    flag can set it. Who can reach `kb ui`'s HTTP and `/ws` is decided by its
    one request guard (`app/server/src/guard.ts`, applied before `/ws` and
    every `/api/*` route). A request passes only when its `Host` names this
    server, which stops DNS rebinding. It must also carry no `Origin` (a local
    program) or the UI's own. A `POST /api/action` must also be
    `application/json`, so a page on another site cannot reach it at all.
  - The browser's one invoke path takes the whole envelope, on the local
    replica and on the push lane. Its caller that sets `approved` is the
    agent sidebar's approval prompt, which makes the call as the agent's,
    with the person's answer (DESIGN-UI.md → Docks).
- `ActionReceipt` = `succeeded | failed` discriminated union, typed failure codes, never throws across boundary.
- **One contract, every surface.** The CLI (`action-invoke`), MCP, HTTP,
  WebMCP and the sidebar agent each list the registry's action ids with
  their declared modes, from their own listing: `kb.manifest`, the MCP tool
  list's `_meta`, `GET /api/manifest`, the tools registered on the page's
  model context, and the tools a turn hands the agent's model, less what
  `listedOn` leaves out for its declared wire and actor. For the same call,
  each returns the invoke core's receipt for that call made by its actor,
  from the composition it reaches (a `kb ui` also reports the extensions it
  hosts, so its `kb.manifest` lists the agent), unless its wire cannot make the
  call at all, which only an action it leaves out may be (WebMCP cannot call
  a tool it never registered). An approved call runs only through a surface
  whose wire carries the approval. One policy decides the same on every
  surface: a denial refuses, an ask refuses an unapproved call, and only a
  policy naming the action lowers its declared approval; and no surface
  writes a policy without a person behind the call. These are
  properties of `surfaceContract` in `@kb/test-kit`
  (`surface-contract.ts`). They run over all surfaces at once, from
  `packages/app/cli/tests/surface-contract.test.ts`, and a new surface joins
  that map.
- `registryFor(root)` builds a handler table per kb root (cached for the
  process); `manifest(root)` + `invoke(ctx, invocation)` / `invokeReceiptEffect` dispatch through it.
- Dispatch prefers `effect` and composes it under `Effect.scoped` (finalizers / interrupt). Legacy Promise `handler`s (third-party `.kb/extensions`) are the only path lifted via `tryPromise`.
- Skipped from harman (YAGNI): profiles, pagination cursors, idempotency
  replay, A2A surfaces. Contracts leave room; Fiber interrupt covers cancellation for native handlers.

### Core boundary & extensions

Core ships mechanism only: store (JSONL), datalog (DataScript), the action
registry, subscription hub, render backbone (docs views, template resolution,
`renderView`), and the CLI/MCP/UI surfaces. Policy — what markdown to write
where, how rows become markdown, repo-specific output of any kind — lives in
**extensions**:

- An extension is a TS module in `.kb/extensions/` (repo-local = trusted)
  whose default export is an array of **contributions**. A contribution is
  either a harman-style action (an `ActionDefinition` plus either Effect
  `effect(input)`, preferred, or a legacy Promise `handler(ctx, input)`) or a
  render **template** (`{ id, aliases?, template }`, see
  `@kb/contracts/template.ts`). The loader discriminates structurally: a
  contribution carrying a `template` function is a template.
- **Everything loads as a plugin into one kernel** (`@kb/plugin`,
  `packages/domain/plugin`, `scope:shared`; the model is DeepSeek Harness's
  Cordis). A plugin is `{ name, namespace?, inject?, apply(ctx) }`; through
  `ctx` it provides and injects typed services, contributes to typed points,
  emits and listens to typed events, and loads children. Everything it
  registers hangs off its Effect `Scope`, so unload closes the scope; a
  plugin waits as `pending` until what it injects exists, and returns to
  pending when a provider leaves. A failing `apply` is atomic: nothing it
  registered survives.
- Actions and templates are two points of that kernel, `ActionPoint` and
  `TemplatePoint` in `@kb/contracts`. Core's actions are a plugin in the root
  namespace (bare ids like `node.add`); each extension is a plugin in
  `ext.<name>`, so both kinds of id are namespaced `ext.<file>.<id>` by the
  kernel, with optional bare-id `aliases`. A default-exported array is the
  declarative form of a plugin — `extensionPlugin` turns it into one — so the
  bundled extensions and the repo's load the same way. `registryFor` loads
  them and derives the handler table, the manifest and the template map from
  the points. A module that fails to import, or a plugin that clashes, is
  reported and skipped as a unit — extension errors never crash core.
  `kb ext list` shows what loaded (and what didn't).
- Templates are handed to the render backbone through the `TemplateRegistry`
  service, provided once by `kbRuntimeLayer`. Core registers **no** template
  of its own: `renderViewEffect` resolves `view.spec.template` against the
  registry and fails `invalid_input` (listing the registered ids) when the
  name is unknown.
- `@kb/ext-docs` / `@kb/ext-canvas` / `@kb/ext-check` export their plugin
  (`docsPlugin`, …) and are Effect-native bundled examples (`effect` handlers using `KbCtx` / `FileSystem` /
  `KbStore` Layers). Docs owns `ext.docs.materialize` / `ext.docs.check` and
  the templates `ext.docs.todos` / `ext.docs.rules`, with the bare ids
  `docs.materialize`, `docs.check`, `todos` and `rules` as aliases. Core keeps
  only the render mechanism the extension calls into
  (`packages/application/operations/src/docs/`).
- The canvas document format is extension-owned (`@kb/canvas`,
  `packages/extension/canvas`) even though it is shared between the backend
  plugin and the browser. It does not belong to the core node model.
- Extensions are loaded once per process; changing one requires restarting
  long-lived surfaces (`kb ui`, `kb mcp`).
- The registry's kernel is not the only host. The browser page and the
  `kb ui` server each run their own kernel of the same `@kb/plugin`, loaded
  by their composition root ([Plugin channels](#plugin-channels)). This is
  how a package outside core, such as an agent package, plugs into a
  surface without core importing it.
- **Extension SDK:** external `.kb/extensions/*.ts` authors get types from
  the running binary — `kb ext sdk --write` emits `.kb/sdk.d.ts` (ambient
  module `kb-ext-sdk`), then `import type { ExtensionAction, ExtensionTemplate }
from "kb-ext-sdk"`. Types are generated from `packages/contract/ext-sdk/src/surface.ts` and
  embedded in the CLI bundle; `bun packages/contract/ext-sdk/scripts/generate.ts` refreshes the
  committed string (freshness-tested). Prefer Promise `handler`s; schemas
  may be zod, Standard Schema v1, or a bare `{ parse }`. Helper siblings
  should `export default []` so discovery stays quiet.
  **Migrating to kb 0.2.0:** replace `mode: "read"` with `mode: { kind: "read" }`
  and `mode: "apply"` with `mode: { kind: "write" }` (add
  `approval: "required"` if a person must approve each call). The loader
  skips an extension that still uses the old strings.

#### Extension families

This is the contract for every feature kb bundles, such as chart, code, lab,
agent, canvas, docs and check. **Core names no feature.** The reasons and
the order of the move are in the
[extension-boundaries plan](../../docs/brainstorms/2026-10-04-kb-extension-boundaries/README.md).
Where the code does not meet this contract yet, a gap says so (listed at the
end).

- **An extension is a family of packages, one scope each.** It is never one
  package with two entries, because the scope fence, the tsconfig preset and
  the isomorphism fence are per package. A family has up to three packages,
  each flat under `packages/extension/`:

  | Package | Scope | Holds |
  |---|---|---|
  | `@kb/<family>` | shared | ids, view keys, seed nodes, text bodies, the family's declaration and its **shared plugin** |
  | `@kb/<family>-ui` | browser | views, routes, sidebar sections, docks and commands, built against `@kb/ui-sdk` ([DESIGN-UI → Extension UI halves](DESIGN-UI.md#extension-ui-halves)) |
  | `@kb/<family>-<adapter>` | backend (shared when isomorphic) | actions, and adapters such as Vega or the Claude SDK |

- **A family declares itself once.** `defineExtension({name, label,
  optional?, seed?, views?})` in `@kb/<family>` is the one home of its name:
  - every entry plugin takes its `name` from the declaration;
  - so do the manifest row and the browser resolver's key;
  - the package's `family:<name>` tag is checked equal to it.
- **Each host loads one entry per family, built from the shared plugin.**
  The server entry and the browser entry are each a call to the shared
  plugin factory plus that host's own contributions, so a key, a seed node
  or a text body cannot differ between hosts. A family with no server-only
  package uses its shared plugin as the server entry.
- **One list decides what is on, and the browser follows it.**
  `BUNDLED_FAMILIES` (`@kb/bundled`) is the list of bundled families, by
  declaration, so every bundled family declares itself in its shared
  package. The server resolves each one's entry by the name the entry takes
  from it (`BUNDLED_EXTENSIONS`, `app/runtime`), and fails at load on a
  family with no entry or an entry with no family. `kb.manifest.extensions` reports each one as `{name, label, optional,
  enabled, source}`. The `kb ui` server adds the host plugins it loaded,
  such as the agent, to the same report. The browser loads the browser
  entry of each family the manifest reports as enabled, through a resolver
  keyed by family name ([DESIGN-UI → Extension UI halves](DESIGN-UI.md#extension-ui-halves)).
  **Optional is a server-side load decision:** a family switched off is not
  loaded by the registry, so its views leave the catalog. There is never a
  second switch in the browser.
  - **The switch is a node.** An optional family is on while the store's
    `sys.extension.<name>` node carries `true` in the checkbox field
    `sys.f.extension.enabled` (`familyOn`, `@kb/contracts`). Neither node is
    seeded: `extension.switch` writes them the first time a person switches
    the family (`switchWrites`), so opening a store never writes them, and a
    store without them has every optional family off. The registry is
    cached per root and per set of families on, so a switch takes effect on
    the next call.
  - `kb ui` hosts the agent unless it is started with `--no-agent`, and
    reports it beside the bundled families. That flag is the agent's one
    switch: a page served without the agent never offers its dock.
- **The seed is the bundled fold, never a loaded registry.**
  `ensureSystemSeed(nodes, seed)` runs at open, before any registry
  exists. `openKbEffect` passes it `bundledSeed(at)` (`@kb/bundled`, a
  `scope:shared` package so the page folds the same seed), which is:
  - core's nodes, then each `BUNDLED_FAMILIES` declaration's `seed`, in
    bundled order;
  - pure data: it opens nothing and fails on an id declared twice.

  Host and repository plugins contribute no seed, so every surface seeds the
  same set whatever it loads, and a failed extension load never shrinks the
  seed. Opening a store with a family switched off neither deletes nor
  rewrites that family's nodes: the data outlives the code.
- **Ids are frozen data.** `sys.f.chart`, `sys.views` options and the rest
  keep their spelling when their declaring package changes, so no store
  migrates and opening still never writes. A rename goes through an explicit
  action, never through open.
- **The view catalog is a point.** `ViewKeyPoint` (`kb.views`, in
  `@kb/contracts`) holds one `ViewDef<P> = {key, text?}` per view, keyed by
  view id. A family's shared plugin contributes the `views` its declaration
  lists. `ViewKey` carries the `label` and `family` that name the view's
  option node under `sys.views`, and that option is derived inside
  `bundledSeed()`, never declared again. A `ViewCatalog` service is the only
  reading of the catalog:
  - the server provides it from the registry kernel;
  - the page derives it from `kb.manifest.views`: the page kernel's keys
    restricted to the ids the manifest lists. A view the manifest lists
    that no plugin on the page holds stays listed by its entry
    (`listedOf`), so a node naming it resolves to that listing and opens as
    "cannot be shown here", named by the server's label.

  So `view.propose`, `render.view` and the manifest see only what is loaded,
  on both hosts.
- **A view's text is part of its contribution.** `ViewDef.text = {body,
  figure?}`. `viewText` looks the view up in the catalog and falls back to
  the generic body. `renderViewNodeEffect` stays the one function behind
  `render.view` and `ui://kb/view/*`.
- **A painter belongs to the view that paints with it; an engine belongs to
  the core port it implements.**
  - A figure (a chart's SVG, a code view's snapshot) is supplied by the
    family's server entry. The browser entry supplies none, so the page's
    isomorphic actions draw text only.
  - Sandbox engines are adapters of the core sandbox port. Composition roots
    bind them as they bind stores, and `sandboxContract` is their shared
    suite.
  - A family that needs an engine asks for a core reference such as
    `UntrustedEngine`. It never binds one itself.
  - No generic "runtime layer point" exists: nothing needs one.
- **Core's write path and render backbone reach a family as contract
  services, never as use cases.** A docs view's bytes reach the docs
  family through `ReadInvoke`, as `render.view` in md, which is the
  backbone every surface asks; which docs views a graph holds is
  `docsViewsOf` and `docsViewNamed` (`@kb/views`). `GraphWrites`
  (`@kb/contracts`) is the write path, and `kbRuntimeLayer` binds it:
  - `commit(tx)` is `persistEffect`: the transaction's integrity is checked
    against the graph it merges into, the approval resolver is asked again
    with what it writes when it runs inside a call, and the index and the
    transaction log move with it.

  `graph-writes.test.ts` (`app/runtime`) holds this over the binding.
- **What stays core** is mechanism, plus the projections the shell is built
  from:
  - the store, datalog, kernel, subscriptions and the render backbone;
  - the outline, graph (`graph.force3d` included) and ontology families;
  - layout (`layout.grid`, `layout.node`, `sys.f.layout`), because the pane
    tree is the workspace;
  - the docs view type (`docs.markdown`). `@kb/ext-docs` owns the templates
    and actions, not the view type;
  - approval policy, `view.propose`, `render.view`, `ui://`, the sandbox
    port, engines and frame host;
  - the generic UI points.
- **Enforcement.** The harness checks the boundary in
  `harness/src/constraints.ts`:
  - each extension package carries one `family:` tag, equal to the literal
    `name` of its family's one `defineExtension` declaration. Any other
    reference to `defineExtension` (an alias, a member call, a computed or
    spread key) fails, because only a direct literal call can be read;
  - an extension package imports another extension package only of its own
    family;
  - an `app` package imports an extension package only from its composition
    root's bundled-extensions file (`EXTENSION_ROOTS`), and a root
    re-exports none. Tests (the package's `tests/` folder and `*.test.*`
    files) are exempt. A breach that is known and deferred is a file named
    in `EXTENSION_ROOT_BREACHES`, under a gap: a file not named fails, and a
    named file that no longer imports the feature fails;
  - every extension package is loaded, by a value import, by the root of
    each host its scope runs in. A `scope:shared` package runs in no host on
    its own, so it is loaded by a root or by a loaded package of its own
    family;
  - a family's browser half is its one `@kb/<family>-ui` package: a
    `scope:browser` extension package is named for its family, a `-ui`
    package is `scope:browser`, and a surface of `@kb/ui` named for a
    family is a deferred breach listed in `CORE_BROWSER_HALVES`, under a
    gap, and the list can only shrink.

  One contract suite, `extensionContract` (`@kb/test-kit`), runs over
  `BUNDLED_EXTENSIONS` and over the host-composed agent. A family passes
  when:
  - it loads and unloads cleanly;
  - its entry contributes exactly the views its declaration lists;
  - its seed ids have one owner;
  - every view key it contributes has an option in the fold;
  - every text body renders its key's defaults;
  - every view it gives the UI has a key in the page's catalog.

  The rule node "Core names no feature" records how far that enforcement
  has landed.

Today's drift from this contract is marked where it sits:
- open composition roots: GAP [[01M41H30Y60D3G9WJJX6NFQD2T]];
- extensions that still reach core's use cases (`@kb/operations`):
  GAP [[01M439W857BD9QQTBEQ5X5D06D]];
- canvas: GAP [[01M39F3MR3HT2NR553FY8CRD6X]];
- the outline's canvas bullet, which the kit names by the canvas tag's
  frozen id: GAP [[01M436DVSEHKNYWSF2MR07HPMR]].

### Canvas documents

A `#canvas` node keeps its layout as one [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/)
document in `sys.f.canvas`, and `ext.canvas.tx.apply` is its one write path:
the UI, the CLI and an agent all send the whole document after their change.
`@kb/canvas` (`packages/extension/canvas/src/doc.ts`) parses and writes it;
item types and fields it does not know survive a round trip untouched, and
so does a known field holding a value it cannot read (a `z` that is not a
finite number, a `depth` that is not, a `rotation` that is not an object of
finite angles, a `camera` or `pose` of the wrong
shape) until kb writes that field itself. The `#canvas` tag
(`sys.tag.canvas`), the field it templates, and the `canvas.list` and
`canvas.page` view keys are the canvas family's too (`CANVAS_IDS` and its
declaration, [Extension families](#extension-families)).

The canvas plane is the floor: x runs to the right and y down the page as
the top view (2D) shows them, and z points up off the floor, all in the same
units. kb's extension fields:

| On       | Field    | Meaning                                                                                                   |
| -------- | -------- | --------------------------------------------------------------------------------------------------------- |
| item     | `nodeId` | what the item means: the store node it stands for. Any item may carry one; a `kb-node` card needs one, and its text and tags render live from the store |
| item     | `shape`  | what fills a `shape` item's box: `rect`, `ellipse`, `diamond`, `sphere` or `cone`. Flat, its outline; with depth, a box, an elliptic cylinder, a diamond prism, an ellipsoid or a cone. Any other item fills its box as a `rect` |
| item     | `z`      | elevation: the height of the item's base above the floor. Absent is 0, the canvas plane, and 0 is written as absent |
| item     | `depth`  | how far the item rises from its base. Absent is 0, flat, and 0 is written as absent; extruding sets this and nothing else |
| item     | `rotation` | `{ x?, y?, z? }`: how the item's box is turned about its centre, in degrees about x, then y, then z, each about the canvas's fixed axes (Blender's XYZ Euler; `@kb/canvas` `rotation.ts` owns the order). Right-handed in canvas coordinates, so with y down the page a positive `z` turns clockwise from the top, as CSS `rotate` does. An absent angle is 0, kb writes only the angles that are not 0 and each within (-180, 180], and an unturned item has no `rotation` |
| item     | `parent` | the group the item belongs to: a `group` item's id. Groups nest, and a group carries its members — what moves, turns, scales, deletes or copies it does so to them, rewriting their world coordinates. One that names no group, or would make the item its own member, is not honoured (the item belongs to the canvas) and is kept as written. kb sets it where an item is placed or let go: of the frames no smaller than it whose face holds its centre seen face-on (carried along the frame's normal onto its plane: a frame on the floor holds what stands over it, one stood up as a wall what is laid on its face), the one nested deepest (then the one drawn on top), or none (`@kb/canvas` `membership.ts`) |
| item     | `billboard` | `true`: in 3D the item's face turns to the camera. A flat item is drawn and picked standing square to the screen, rising from where it lies (from the top it is its footprint, so its `rotation` is not drawn); a solid keeps its body and shows its face in front of it, as a sphere's or a cone's always does (`faceStands`). Absent is false, and it is written only when set |
| item     | `file`   | a `file` item's picture (the JSON Canvas field, typed): the `assets/…` path `asset.upload` answers with, the same one markdown's `![](assets/…)` names, so a picture on a canvas and in a note are one asset. Only an `assets/…` image is drawn as a picture; any other file — a URL elsewhere included, which would make every viewer fetch it — shows its path. Its `subpath` round-trips as an unknown field |
| edge     | `kbLink` | the one-shot native bind of a drawn edge ([INSPIRATIONS](INSPIRATIONS.md): edges are drawings)            |
| document | `camera` | `{ projection: "2d" \| "3d", pose? }`: which projection the canvas opens in, and its last 3D pose; absent is 2D |

A `pose` is `{ x, y, z, zoom, yaw, pitch, fov? }`: the point looked at,
screen pixels per canvas unit on the plane through it, the turntable orbit
about it in radians (yaw turns about z; pitch runs from 0, looking straight
down, to π/2, level with the floor), and the lens as a vertical field of view
in degrees, 0 orthographic. A pose without `fov` is seen in perspective.
Every item is a box — its footprint, its `z` and its `depth`, turned by its
`rotation` about its centre — and its shape
fills it (the shape table, `@kb/canvas` `shapes.ts`). In 3D, `z` is a real
axis; from the top, items paint by the height of their top surface
(`z + depth`, a turned item's highest corner) and then in document order,
which bring-to-front and send-to-back rearrange; at one height a group
paints before its members, whatever their order. An agent sets height,
volume and turn the way it moves a card: it writes `z`, `depth` and
`rotation` on the item and applies the document; a solid preset (box,
pillar, sphere, cone, slab, wall) is nothing but a shape item with depth.

The camera is view state, not content: the undo history leaves it out. It
sits on the document only until canvases become view nodes, and then moves to
that view's settings (`camera.ts`, `GAP [[01M3S5DD5W4B3BSZMA6DE8ZVP8]]`).

#### Agent verbs

An agent that cannot see a canvas edits it by relation, never by working out
a coordinate (plan 2026-10-02, decision 16). The verbs are `ext.canvas.*`
actions (Operations), so every surface lists them and the invoke core
decides their approval like any action's: a policy names one by its id,
the family by `ext.canvas.*`, or every write. Each is a pure function in
`@kb/canvas` over the document, resolved through the code a person's
gestures go through — the one transform (`transformItem`), surface snap
(`snap.ts`), membership and the drop rule (`membership.ts`), placing on a
frame's face (`placedOnFace`), the edge record the pointer's edge drag makes
(`connectItems`) — and each write is one `commitCanvasEffect`: one store
transaction, one step of an open canvas's history.

- **Relations read both ways** (`relations.ts`). Directions are the canvas's
  own axes — left and right along x, north and south along y (north up the
  page), above and below along z — never the camera's or an item's own, and
  a turned item is compared by the box bounding it along them (`boxBounds`;
  `GAP [[01M42Q9GJKTE064D3SG8JEPA4M]]`). `describe` says "a is `side` of b, `gap`
  apart" exactly when `place` would have put a there: the side along which
  their bounds stand farthest apart (`directionFrom`), and two items that no
  direction parts overlap (`overlaps`). A flat item at a solid's base is in
  it; one on its top rests on it (`restingOn`, what surface snap stands it on).
- **`place`** makes or moves items `near` another on a side with a gap
  (level with it, its base aligned with the target's), `on` one (centred,
  standing on its top), `in` a frame (row by row, clear of its members; on a
  frame that stands, laid on its face), or `at` plain coordinates (landing as
  a carry lands when no height is given). A spot that is taken steps further
  out by the grid until clear. A moved item carries its members (`editItem`)
  and belongs where the drop rule says; one placed `in` a frame that cannot
  hold it is refused. A new item is a preset with words (`makeItem`).
- **`arrange`** lays items out as a row, column, grid, ring or stack, or as
  layers whose height follows a field's value on each item's node.
- **`connect`** draws an arrow between the sides facing each other; `bind`
  also sets a ref field on the source's node, once, in the same transaction.
  **`group`** gathers items into a frame a grid step round them, as ⌘G does;
  **`ungroup`** takes frames apart. **`promote`** makes a node of a text
  card's words (no parent, node first: D6), and the card shows it.
- **Lints** (`lint.ts`): `overlap` (one of the two a solid), `floating`
  (raised with nothing under it and no frame face it lies on),
  `missing-end`, `missing-node`, `missing-group`, `outside-frame`. Every
  canvas write — `tx.apply` included — answers `lints: {new, resolved}`,
  and `ext.canvas.lint` reads them.
- **`describe`** gives each item's kind, words and box and the relations
  `on`, `in`, `linked` and `near`, at three levels of detail: the items in
  focus (the `focus` asked for, else the open tab's selection, else what it
  shows) in full, the rest on screen blurred to what and where, and what is
  off screen counted per frame. With no tab showing the canvas, every item
  is in full. It also gives the lints, the camera and the tab's screen.

## Operations (verticals)

| Action                                            | Mode  | Does                                                                                                         |
| ------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| `node.add`                                        | write | create (text, props by field name/id, parent, position, tags)                                                |
| `node.update`                                     | write | edit text / set-unset props / move                                                                           |
| `node.delete`                                     | write | delete a node, its descendants with it unless `descendants: "reparent"` (`kb rm`)                           |
| `node.get`                                        | read  | pull subtree to depth N                                                                                      |
| `field.define` / `tag.define`                     | write | mint field/tag nodes (sugar over node.add)                                                                   |
| `graph.query`                                     | read  | raw datalog → JSON rows                                                                                      |
| `graph.run`                                       | read  | execute saved query from `.kb/queries/`                                                                      |
| `graph.search`                                    | read  | text/prop filter convenience                                                                                 |
| `ontology.members`                                | read  | resolve an `#ontology` node's membership, with provenance ([Ontologies](#ontologies--a-lens-over-the-graph)) |
| `asset.upload`                                    | write | write opaque bytes to `.kb/assets/<ulid>.<ext>`, at most `ASSET_MAX_BYTES` (25 MiB, the one limit a page also checks before reading a file); returns the `assets/…` markdown path |
| `render.view`                                     | read  | render a docs view (a `docs.markdown` view node, by name) to html or md                                      |
| `render.views`                                    | read  | list the docs view names available to `render.view`                                                          |
| `views.migrate`                                   | write | rewrite a store written before view nodes to them and import `.kb/views` ([View nodes](#view-nodes))         |
| `kb.manifest`                                     | read  | list every registered action as its manifest entry (MCP's `kb_manifest`), the view catalog and the extensions ([Extension families](#extension-families)) |
| `extension.switch`                                | write | turn an optional extension on or off for this kb: the registry loads it, or leaves it out, from the next call ([Extension families](#extension-families)) |
| `ext.docs.materialize` (alias `docs.materialize`) | write | render the docs views → write md (bundled extension)                                                         |
| `ext.docs.check` (alias `docs.check`)             | read  | materialize to memory, diff vs disk (bundled extension)                                                      |
| `ext.canvas.tx.apply`                             | write | apply a JSON Canvas transaction to a `#canvas` node (bundled extension); answers the lints it made and cleared |
| `ext.canvas.describe` / `ext.canvas.lint`         | read  | a canvas in words, at three levels of detail / its lints ([Agent verbs](#agent-verbs))                        |
| `ext.canvas.place` / `arrange` / `connect` / `group` / `ungroup` / `promote` | write | edit a canvas by relation, one write each ([Agent verbs](#agent-verbs))              |
| `ui.screen`                                       | read  | the open UI tabs' screen state, most recently active first ([Screen state](#screen-state))                   |
| `ui.navigate` / `ui.select`                       | write | open a node or route, or point a canvas camera / set the selection or focus in a UI tab ([Screen state](#screen-state)) |
| `ui.capture`                                      | read  | have a tab's canvas draw a view as a PNG, kept under `.kb/captures/`, the camera left where it is ([Screen state](#screen-state)) |
| `sandbox.trust` / `sandbox.untrust`               | write | trust, or stop trusting, sandboxed code on this machine by its digest; trusting asks ([Sandbox](#trust))     |
| `sandbox.trusted`                                 | read  | which of these code digests a person trusted on this machine ([Sandbox](#trust))                             |

**Breaking change (roadmap step 5c), with no alias:** deleting is
`node.delete`. `node.update` no longer takes `delete` or `descendants`, and
its output always carries the node. Deleting is its own action because it is
the write a caller most needs to name on its own: an approval policy matches
an action by its id ([Action registry](#action-registry)).

## Materialization

- **A docs view is a view node** (Kinds, roles and options → View nodes): its
  `sys.f.view` names `docs.markdown`, and its params are its subject query
  — held (`lens.query`) or a saved query's name (`sys.f.view.saved-query`),
  exactly one, the name resolved when it renders — its template
  (`sys.f.view.template`) and its repo-relative output
  (`sys.f.view.output`). Those are the params of its view's key
  (`DocsMarkdownView` in `@kb/views`), and the render layer reads a docs
  view through that key like a host reads any view, so what a docs view
  cannot be read without is named by its path. Its text is the name `render.view`,
  `render.views`, `docs.materialize`/`docs.check` and MCP's `render_view` /
  `ui://kb/view/<name>` (the name URI-encoded) know it by, so those
  contracts keep their names. The name is a workspace name that no other
  docs view goes by (`docsViewNameError`): the write check refuses a write
  that makes or renames a docs view against it, as it refuses a value its
  field cannot hold. A docs view that still cannot be read — a name stored
  before the check, or a missing param — never stops the others: it is a
  warning in `docs.check` and `docs.materialize`, left out of
  `render.views` and MCP's resource list, and a failure naming what is
  wrong only when it is asked for by name. The `.kb/views/*.json` specs
  were a second store of the same concept — a chosen projection: which
  rows, through which template, to where — so they are retired rather than
  kept beside the nodes, and nothing reads them but `views.migrate`, which turns a root's
  leftover specs into docs view nodes (`docs.<name>`, filed in the Views
  list; GAP [[01M3YM5YCHGX6S04KN4G75B9RF]]). Templates are named TS functions
  (rows → md), no template-lang dep. They are contributed by extensions
  (core registers none) and referenced by their namespaced id
  `ext.<file>.<template>` or by an alias the extension declares.
- **v1 ships exactly one view: `docs/kb/todos.md`** (nodes tagged `todo`,
  grouped by status). Curation of more views comes later, driven by tags.
- Generated files carry `<!-- generated by kb; do not edit -->`.
- **`docs.check` in pre-commit from day 1**: `.githooks/pre-commit` gains a
  `kb check` step in the same milestone that ships materialize (M4).

## Surfaces

- **CLI** (`commander`, `#!/usr/bin/env bun`): human commands + `kb action-invoke <json>`; `--json` everywhere. Internal command orchestration is Effect (`resolveRootEffect` → `openKbEffect` → `runPlanEffect` / `invokeReceiptEffect`) with an `Effect.runPromise` + exit-code boundary at each Commander surface action (not a claim that the whole process has a single runPromise). Commander itself stays the argv contract.
- **MCP** (`kb mcp`, `@modelcontextprotocol/sdk` stdio): `kb.manifest` as an
  agent, read at each `tools/list` → one tool per action it may call → Effect
  handler (`callToolEffect` / resource Effects via `reloadEffect` + `invokeReceiptEffect`); tool hints from the mode ([Action registry](#action-registry)). SDK request handlers remain Promise-returning; CallTool maps Fail/Die to `isError`, resource Fail/Die to JSON-RPC `-32603`.
  - **Breaking change (roadmap step 0), with no alias.** MCP no longer has
    hand-written tools; every tool is a registry action.
    - `render_view` is now `render.view`. Its argument is `name` (it was
      `view`), and it returns the action's output `{name, format, content}`
      as JSON, not the bare content.
    - `kb_manifest` is now `kb.manifest` and returns `{actions, views}` (the
      view catalog, Kinds, roles and options → View nodes), not a bare
      array.
    - A caller that used the old shapes has to switch to the new ones. The
      tool list (`tools/list`) states the new input schemas.
    - Since roadmap step 3, `render.view` also takes a view node's `id`
      instead of a `name`, and its output adds `id` and `view` (Kinds,
      roles and options → View nodes).
  - **Views are MCP App resources** (the MCP Apps extension, spec
    2026-01-26). `resources/list` lists every view at
    `ui://kb/view/<segment>` — a docs view by its name, any other view node
    by its id; a segment that is a docs view's name names that docs view —
    as `text/html;profile=mcp-app`. Reading one renders it through
    `render.view`'s path (`renderViewNodeEffect`) and returns a snapshot as
    of the read, with `_meta.ui.prefersBorder`: the page, the time it was
    rendered, and a refresh (`app/mcp/src/view-app.ts`). The refresh shows
    only once the host answers `ui/initialize`; it asks the host to read the
    same resource again (`resources/read`), so the fresh snapshot is stamped
    by the server that rendered it, and swaps it in. Outside a host it is
    never shown. There is no live push, because a remote host
    has no path back to a local kb server (roadmap decision 9). The page is
    kb's own render, never model-written HTML, and it needs no network, so
    it declares no CSP. A host that renders no `ui://` resource (Claude
    Code) reads the same view as markdown through `render_view`.
- **WebMCP** (`@kb/webmcp`, loaded by the kb UI as the built-in `webmcp`
  plugin): the registry as tools of the open page, for an agent that drives
  the browser. It follows the WebMCP draft of 2026-09-29
  (`document.modelContext.registerTool(tool, {signal})`), which ships only
  behind a Chrome flag or origin trial.
  - Where the page has no `document.modelContext` the adapter does nothing.
    kb ships no polyfill: its tests use a spec-shaped fake, and a polyfilled
    context reaches no agent without a browser extension or relay beside it.
  - One tool per action `kb.manifest` lists to an agent, less what
    `listedOn` leaves out for `WEBMCP_WIRE`; it lists again when the
    replica's approval policies change. The name is the action id (dotted ids are legal WebMCP
    names), the title and description are the manifest's, the `inputSchema` is
    the same object schema MCP publishes (`asObjectSchema`), and the hints
    come from the mode ([Action registry](#action-registry)).
  - `execute` runs through the browser's one invoke path, which decides
    whether the call runs on the local replica or on the server
    (DESIGN-UI.md → Architecture). WebMCP reads a throw as the tool's error, so
    `execute` returns the receipt when it succeeded and otherwise throws
    `ToolCallFailed`, whose message is the receipt's and which carries the whole
    receipt. In the UI a local write answers only once the server has, so a
    write the server rejects is never reported as done.
  - Every tool of one listing shares one `AbortSignal`. Aborting it is how
    tools unregister: when the listing differs after the live socket opens
    again (the registry is cached per server process), when the page is
    hidden, and when the plugin unloads.
  - `execute` has no envelope for `approved`, and `consequentialHint` asks the
    agent to confirm a write without telling the page whether it did, so
    actions that ask an agent are left out (`GAP-WEBMCP-APPROVAL`).
- **Agent onboarding**: CLAUDE.md/AGENTS.md section — node model, field/tag
  conventions, 5 example invocations.

### Remaining Effect surface boundaries

- `surface/ui/**` HTTP routing, assets, and SubscriptionHub are Effect programs;
  Bun.serve remains the listen/WS/`Bun.file` boundary (see Runtime/tooling
  boundary and DESIGN-UI.md). `/api/action` composes `invokeReceiptEffect`
  directly (no nested `invoke` Promise).
- Repository-owned / core / bundled action handlers are Effect-native end to
  end (`effect` + Layers). Third-party `.kb/extensions` may still export
  Promise `handler`s; those alone use `tryPromise` inside `invokeEffect`.
- Registry discovery still uses dynamic `import()` of extension modules
  (Promise at the load boundary). Standard Schema `validate` may return a
  Promise and is lifted once at parse time.
- Surface tips (`CLI` Commander actions, MCP SDK handlers, `Bun.serve`) still
  call `Effect.runPromise` / `runPromiseExit` at the process edge — not inside
  action handlers.
- No `@effect/cli` adoption (Commander preserved by design).

## Screen state

Agents know what is on the person's screen and can move it, through
ordinary registry actions and without a database (roadmap decision 7 in
`docs/brainstorms/2026-09-29-kb-genui-canvas-agents/README.md`). Every
shape is typed once, in `contracts/src/screen.ts`; the wire ops are in
`protocol.ts`.

- **The channel is `/ws`, per tab, in memory.** A UI tab is a `/ws`
  connection that has sent `{op: "screen", state}`: its route, whether it
  has the person's attention (`active`), and its panes, each with the open
  view (its view key id and the node it is shown for), the focused node,
  the selection in the view's own ids, and for a canvas the projection
  showing, its camera as a `pose` (Canvas documents; in 2D the top view,
  orthographic; in 3D as it last came to rest) and the ids of the items that
  camera shows. The message names its tab id; the UI starts as its
  page's origin id, which is minted per page load and so is per tab.
  The id belongs to the first live connection that publishes it. Another
  connection naming a live tab's id gets `screen-refused`, picks a fresh id
  and publishes again, so no connection can take over another's tab. A
  connection's close forgets only the tab it owns. The tab sends its whole
  screen on connect and on every change, throttled (`src/screen.ts` in the
  UI). The `kb ui` server (`ScreenHub`) keeps the latest record per tab and
  forgets it when the owning connection closes.
  Nothing is written to the store, and a server restart forgets every tab
  until each republishes on reconnect.
- **Every pane is in the record.** `panes` lists the workspace's panes
  (Layout views above), each with its location (`route`) and the view that
  location resolves to. For a node opened at `/node/<id>` that is the view
  it opened in, and `node` names the view node it shows when it shows one.
  `activePane` is the focused pane, the one the URL names. A command may
  name its `pane`. Without one it goes to the focused pane, and it is
  refused for a pane the tab does not have. A dashboard's own panes are part
  of their pane's view, so they are not listed (GAP [[01M411FPSNN7B18JQ62RKB8ZXW]]).
- **`ui.screen`** (read) returns the live tabs, most recently active first:
  the last tab to publish while it had attention comes first, and tabs that
  never had it follow in the order they arrived. `tab` narrows the list to
  that tab.
- **`ui.navigate` and `ui.select`** (writes) are commands. The server sends
  `{op: "screen-command", id, command}` to one tab, the most recently
  active by default, and waits up to `timeoutMs` (default 2 s) for that
  tab's `{op: "screen-ack", id, result}`. The receipt is always a success
  whose output says what happened: `applied`, `rejected` with the tab's
  reason, `timeout`, or `no-tab` when no live tab could take the command,
  including a tab that closes before it answers or whose socket will not
  take the command (answered at once, not after the wait). `timeout` says only that
  no answer came in time: the tab may still carry the command out, and its
  late answer is dropped. `ui.navigate` takes a
  `node`, opened at its node route in the pane, or a `route`, and a
  `camera` target for the canvas the pane then shows (`CanvasViewTarget`:
  a pose as `ui.screen` reports one, or a view preset, items to frame, or
  both; a frame alone is looked at face-on, as "go to frame" does), or the
  camera alone for the canvas already open — so an agent can *show* the
  person something (plan 2026-10-02, decision 16). Given a node or a route,
  the camera goes to the view the navigate opened once it reports, and a
  view with no camera refuses it. `ui.select`
  takes a `selection`, a `focus`, or both. Every command but a navigate's
  own move is the open view's to carry out or refuse, through the one
  handler it registers for its pane (`PaneCommand`), and its answer may come
  later than the command (a camera that waits for its view).
- **`ui.capture`** (read) has a tab's open canvas draw what its camera would
  see from a `view` (the same `CanvasViewTarget`; absent, as it looks now)
  without moving the person's camera, through its 3D scene: the scene draws
  the view for two frames (one to build it, one copied as a PNG in the task
  that drew it, since a WebGPU canvas lets go of a frame once shown), then
  the person's view again — in 3D the person glimpses those two frames
  (`GAP [[01M42Q9HYATJ1XEZNJGXAGMAKC]]`). 2D
  is that scene's top view, so a canvas showing 2D mounts its scene unseen
  for as long as the picture takes. The tab answers with the PNG (its ack's
  `picture`); the `kb ui` server keeps it under `.kb/captures/` — runtime
  state like `.kb/ui.json`, the newest 24 kept, never committed or backed
  up — and the receipt names the file (`capture.path`), which a local agent
  opens to see it. A capture waits 10 s by default. With no tab it answers
  `no-tab`, as every command does (plan "gaps": a capture needs an open
  tab). Tool results carry the file's path, not the picture
  (`GAP [[01M42Q9HJJ0H5GDGXKJ2CW5HEC]]`).
- **No approval.** The two commands change what one tab shows, never the
  graph or the workspace, and a person undoes either with one gesture.
  Approval would also keep them off MCP and WebMCP (`listedOn`), the
  surfaces an agent uses to follow and steer the screen.
- **Every process reaches the one server.** The actions ask for the
  `Screens` port, which `kbRuntimeLayer` takes as an input. The `kb ui`
  server passes its `ScreenHub`, so it never asks itself. Every other
  process gets the default, `remoteScreensLayer`, which reads
  `.kb/ui.json` and asks that server the same action. `kb ui` writes
  `{url, pid, root}` there (mode 0600) when it listens and removes it when
  it stops. It is runtime state, gitignored and not backed up. Before it
  forwards anything, the reader asks the server named there which root it
  serves (`GET /api/identity`, behind the request guard, with a short
  timeout). A root that no server serves has no tabs. Neither has one whose
  file points at a server that has died, does not answer in time, or serves
  another root. That is an answer, not a failure. So `ui.*` reach MCP, HTTP,
  the CLI and WebMCP like any action, and `surfaceContract` runs them over
  every surface against one fake tab connected to the root's one `kb ui`.
  `remoteScreensLayer` is kb's one mechanism for asking the `kb ui` that
  serves a root. It is written for the screens alone. When a second port
  needs the serving `kb ui`, generalize it into one forwarder rather than
  add a second.

## Plugin channels

A plugin can hold its own conversation with the connections of `kb ui`
(the agent sidebar's chat is the first). The shapes are typed once in
`contracts/src/channel.ts`, and the wire op is in `protocol.ts`.

- **The server is a plugin host.** `startUi` takes `plugins`. It makes its
  own `@kb/plugin` kernel, provides `UiHost` into it, and then loads the
  plugins in order. The browser page is a host in the same way. The server
  names no plugin itself: its caller, a composition root, does (the CLI's
  `kb ui`). A plugin that fails to load is reported and skipped, and so is
  one still waiting for a service. Neither stops the server. Each plugin's
  scope closes when the server stops.
- **`UiHost`** is what the server offers: the root, the manifest, and
  `invoke`, which runs an invocation as `POST /api/action` does
  (`serverInvoke`: reload, then the invoke core), approval included, and
  always answers a receipt.
- **A channel is a contribution to `ChannelPoint`**, under its namespaced
  id (`agent.chat`). The frame is `{op: "channel", channel, data}` in both
  directions. `data` is the channel's own contract, which its plugin
  states. The hub hands it over untouched with the sending connection as
  the peer: its id, the tab it publishes its screen as, and a `send` back
  to it alone. A close reaches every channel's `drop`. A channel no loaded
  plugin owns is answered with an `error` of code `unknown_channel` whose
  `id` names it.
- **No new endpoint.** Every frame rides a `/ws` socket that the request
  guard already admitted, so a channel is as reachable as the screen is,
  and no more.
- In the browser, `KbWsClient.listen` and `sendChannel` carry a channel. A
  frame sent while the socket is down is dropped rather than replayed,
  because the plugin forgets a connection that closes.

## Agent packages

The sidebar agent lives outside core, in packages that core never imports
(roadmap decision 8). They reach the surfaces through the hosts' kernels.

| Package | Layer, scope | Holds |
| --- | --- | --- |
| `@kb/agent` | extension, shared | the runtime port, the channel's protocol, the bridge plugin, the prompt, the transcript the sidebar draws, and a scripted runtime |
| `@kb/agent-claude` | extension, backend | the port's adapter over the local Claude Agent SDK |

- **The bridge is a plugin of `kb ui`.** `agentPlugin({runtime})` injects
  `UiHost` and owns the channel `agent.chat`
  ([Plugin channels](#plugin-channels)). Anywhere else it waits, pending,
  and does nothing.
- **The runtime is a port**, and each backend is an adapter of it.
  `AgentRuntime.turn(turn)` streams the reply's text and a `session`
  handle, and it ends when the turn does. Interrupting the stream cancels
  the turn, including a call that is waiting for the person. A turn
  carries the system prompt, the message (the text and the sender's
  screen), `resume` (the runtime's last `session`, which the bridge never
  reads), the tools and `call`. The bridge owns the conversation, the
  tools, approval and the prompt. A runtime owns only how one turn of a
  model runs. ACP or another provider would be a further adapter, not a
  fork. Tests run on `scriptedRuntime`.
- **Every message carries the sender's screen.** The bridge asks
  `ui.screen` for the tab that the sending connection publishes as. It
  names the nodes that screen mentions (the open view's subject, the
  focus and the selection, at most 12, through `node.get`) and hands the
  result to the runtime as JSON. A runtime sends it as a `<screen>` block
  before the text (`userTurnText`). A sender that is not a tab sends no
  screen.
- **The tools are the registry**: what `kb.manifest` lists to the agent,
  filtered by `listedOn(AGENT_WIRE)` (`listingOf`), read at each turn. The
  agent's wire carries approval, because a call that needs approval reaches
  a person before it runs, so the agent lists every action not denied to
  it.
- **A call runs through the invoke core, which decides it.**
  - Every call runs at once through `UiHost.invoke`, as the agent's
    (`AGENT_WIRE`), and the bridge sends `tool-call`.
  - When the invoke core answers `approval_required`, the bridge sends
    `approval` for that call and waits. The sidebar asks the person. It
    then makes the call itself, through the browser's one invoke path,
    as the agent's, with `approved` set to the person's answer, and
    replies with that call's receipt. Declining is the same call without
    approval, so the invoke core answers it `approval_required` again.
  - The bridge never predicts which calls ask, so whatever the invoke
    core decides is what the person sees. A refusal for want of approval
    comes before anything is written, so the first attempt costs nothing.
  - The bridge never declares approval. It takes only a receipt of the
    same action, for a call that is waiting on that connection. Like
    `approved`, the receipt is what the caller reports, not a proof
    ([Action registry](#action-registry)).
- **Conversations are ephemeral.** The sidebar mints the id. A
  conversation belongs to the connection that started it and runs one
  turn at a time. Closing that connection stops its turn and forgets it.
  A connection holds at most `MAX_CONVERSATIONS_PER_CONNECTION` (8):
  starting another closes its least recently spoken-in one the same way
  (its turn ends `cancelled`, a call waiting for the person is dropped),
  so a connection cannot grow the bridge without bound.
  Nothing is written to the store. Threads kept as nodes are the
  canonical shape (GAP [[01M40WSVNKVH3ZY8QE0GN5DY8X]]). A backend may keep its own record
  of a session, as Claude Code does.
- **`kb ui` hosts the agent over the local Claude** (`claudeRuntime`), and
  `--no-agent` leaves it out. The CLI is the composition root that names
  it, and it loads the agent packages only for `kb ui`. The server reports
  the agent in `kb.manifest.extensions`, and the page offers the agent's
  dock only while it is reported ([Extension families](#extension-families)).
  - The adapter runs Claude Code through the Claude Agent SDK under the
    login the person already has. kb configures no API key and reads none.
  - It uses the `claude` on PATH. Failing that, it uses the SDK's bundled
    binary, which only a checkout's `node_modules` holds.
  - The model's only tools are the turn's, served by an in-process MCP
    server built for each turn. They have the names, hints and results
    of `kb mcp` (`mcp-tool.ts` in contracts), and none is deferred behind
    tool search.
  - Claude Code's own tools, settings, CLAUDE.md files and MCP servers are
    all left out. Claude Code runs in the kb root, and its permission mode
    lets kb's tools run without asking, because approval is kb's decision,
    made by mode.
  - `resume` is Claude Code's session id. Claude Code keeps that session
    in its own store, so the transcript lives in Claude Code's files, not
    in kb's.
- `surfaceContract` runs the agent as one more surface (`agent`) over a
  scripted model. It covers the listing, every receipt, and an approved
  call made by the person.

## Sandbox

Code that a model writes runs in a sandbox (roadmap decisions 4 and 5 in
`docs/brainstorms/2026-09-29-kb-genui-canvas-agents/README.md`). A code view
(View nodes → Code views) draws something; a script, attached to a view,
would add behaviour to it (GAP-SCRIPTS below). Both are one system: one
capability API, one bridge, two engines under one contract. The vocabulary
is `@kb/sandbox` (`packages/contract/sandbox`); the engines are
`@kb/sandbox-quickjs` and `@kb/sandbox-worker`.

### The capability API

- **One dialect on both hops.** Guest code talks to the frame that runs it,
  and the frame talks to the kb page, in the MCP Apps bridge's JSON-RPC
  (`MCP_APPS_METHODS` in `@kb/contracts`; the messages are
  `protocol.ts`). A graph read or a write is `tools/call` of a registry
  action, so a guest's call passes from hop to hop unchanged and reaches the
  invoke core like any other call. kb's own methods are `kb/draw`,
  `kb/event`, `kb/fail` and `kb/status`. Everything a guest or a frame sends
  is decoded before anything reads it.
- **The guest's API is one prelude** (`prelude.ts`), run first in every
  engine above a bare string pipe (`__kb_post` out, `__kb_receive` in), so
  both engines offer the same API: `kb.subject`; `kb.node(id, depth)`
  (`node.get`); `kb.query(edn)` (`graph.query`); `kb.invoke(action, input)`,
  which resolves to the output or rejects with an error carrying the
  receipt's `code`; `kb.draw(drawing)`; `kb.on(type, handler)` for `click`,
  `input`, `change` on what it drew and `data` when the graph changed;
  `kb.h`; and `console`. The code is the body of an async function, so it
  may `await` at its top level, and any error it throws, now or in a
  handler, ends the run with that error's message.
- **A drawing is data, never HTML** (`drawing.ts`): text, an element
  `[tag, attrs?, ...children]` or a list. The host builds it from an
  allowlist of HTML and SVG elements and attributes: nothing that runs
  script (`script`, `on*`), loads (`img`, `src`, `url(` in a style, an SVG
  paint server outside the drawing) or navigates (`a`, `href`, `form`,
  `formaction`) survives. The browser builds it element by element
  (`drawingToDom`, no parser); a snapshot writes it as escaped HTML
  (`drawingToHtml`).
- **`runGuest`** is the one driver every host uses: the frame in the
  browser, the snapshotter on the server and the contract suite. It starts
  the engine, decodes what the guest sends, draws through the allowlist,
  and answers calls through the host's capability host.
- **`answerToolCall`** is the host side: the grant decides whether a call
  may be made at all, then the invoke core decides it as the `script`
  actor. The guest's call has no envelope, so it can name no actor and
  approve nothing; only its host can bring a person's answer.

### Grants and the script actor

- **A grant** (`CodeGrant` in `@kb/sandbox`, a code view's setting) is
  `{reads: none | subject | graph, actions}`. `subject` reads the node the
  code is shown for and the nodes under it, through `node.get`; `graph`
  reads every node and may run `graph.query`; any other action must be
  named in `actions`. `grantRefusal` refuses the rest with `forbidden`
  before the invoke core is asked. The default reads the subject and calls
  nothing.
- **`script`** is the fourth actor (`ACTORS` in `@kb/model`): code in the
  sandbox, whoever wrote it, never a person. `SCRIPT_WIRE` carries approval
  only as far as its host can put a person behind a call. Its seeded
  policies give it the agent's caution — it is asked before `node.delete`
  and `views.migrate` — and deny it `sandbox.trust`; writing a policy asks
  it like every caller. In the kb UI a call that asks shows a card in the
  code view: Approve once makes the same call as the script's with
  `approved`, Decline makes it without, and the invoke core refuses that
  again (DESIGN-UI.md → Code views).

### Limits

`SandboxLimits` bound a run, per engine (`ENGINE_LIMITS`): time per turn
(500 ms in QuickJS, 5 s in a Worker), heap (32 MB in QuickJS; a Worker's
cannot be capped), stack, messages per second (200), message and result size
(512 Ki characters), calls waiting at once (16) and drawing size (10 000
nodes). A turn is one delivery to the guest with the promise jobs it leaves.
Crossing any bound ends the run with a reason (`GuestEnd`: `interrupted`,
`out-of-memory`, `flood`, `oversized`, `error`, `stopped`) and a sentence a
person can read; the host stays up. The page also cuts off a frame that
sends it more than 400 messages a second.

### Engines

- **QuickJS-wasm for untrusted code** (quickjs-emscripten 0.32.0, MIT, the
  `singlefile-browser` variant, which embeds its WebAssembly so a page with
  no connection still loads it and a bundle needs no asset). Each run gets
  its own WebAssembly instance; the guest's realm holds the language and
  the prelude and nothing of the host. QuickJS enforces the bounds itself:
  an interrupt handler ends a turn past its deadline (and remembers it, so
  a guest that catches the interrupt in an async function is still
  stopped), and the runtime refuses an allocation past the heap and a frame
  past the stack.
- **A Worker for trusted code**, started from a blob holding a bootstrap,
  the prelude and the code (nothing fetched, nothing evaluated from a
  string). It runs at full speed. The bootstrap keeps the pipe's ends and
  removes every API that connects, stores, schedules or spawns, so the
  guest sees the same API; a watchdog terminates a turn past its bound.
  The removal is a courtesy; the boundary is the frame's CSP, which the
  Worker inherits.
- **One contract.** `sandboxContract` (`@kb/test-kit`) holds both engines,
  from each engine's tests, to the same properties: they draw, read as the
  script within the grant, a write that asks comes back
  `approval_required` and cannot be approved by the guest, no network,
  timers or raw pipe, an infinite loop (also in a handler) is interrupted, a
  memory bomb, a message flood, an oversized message and too many waiting
  calls are stopped, errors end the run with their message, and the host
  stays up after a run it cut off.

### The frame

- An iframe sandboxed with `allow-scripts` alone (`SANDBOX_IFRAME_FLAGS`),
  so its origin is opaque: no storage, cookies or DOM shared with the page.
  `kb ui` serves its document at `/sandbox` (`sandboxFrameDocument`) with
  `SANDBOX_FRAME_CSP`: `sandbox allow-scripts` (sandboxed even when opened
  directly), `default-src 'none'`, `script-src 'self' 'wasm-unsafe-eval'`,
  `worker-src blob:`, `connect-src`, images, fonts, media, objects, frames
  and `form-action` `'none'`, `frame-ancestors 'self'`. Its one script,
  `/sandbox/frame.js`, is built on its own (`vite.sandbox.config.ts`) into
  a classic file with every import inlined: a module script would need CORS
  from an opaque origin, and a second file a connection.
- It is an MCP Apps app whose host is the page: it sends `ui/initialize`,
  takes the run as `ui/notifications/tool-input` (`RunInput`: code,
  subject, engine, limits), runs it, reports `kb/status`, and forwards the
  guest's `tools/call`. It listens only to its parent window.
- The page's end (`lib/sandbox-host`) listens only to its own frame's
  window, answers the handshake with the theme's tokens, and answers tool
  calls through `answerToolCall` over the browser's one invoke path. A frame
  that loads a second document after it initialized — the one navigation a
  CSP cannot forbid — is cut off and sent nothing more.

### Trust

- **Untrusted by default; trusted by a person, per digest, per machine.**
  `codeDigest` is the SHA-256 of exactly what runs: the code as stored,
  untrimmed, and its grant (`kb.sandbox/1`). The page computes it from the
  code it shows and hands the frame, never reads it from the node or the
  guest; one changed character, or a wider grant, is code nobody trusted.
- `sandbox.trust` (write, approval required), `sandbox.untrust` (write) and
  `sandbox.trusted` (read) reach the `CodeTrust` port (`@kb/contracts`),
  whose adapter (`@kb/workspace-fs`) keeps `.kb/trust.json`: gitignored,
  backed up by Mackup, each record naming its machine and only this
  machine's honoured (`docs/backup-strategy.md` → kb Code Trust).
- A human's gesture is never asked; the seed denies `sandbox.trust` to an
  agent and to a script, so no code promotes itself and no agent promotes
  code a person has not seen; the CLI asks. Trust changes the engine and
  its limits, never the capabilities: a trusted run has the same API and
  the same grant.
- Promoting a code view to a view type is the same act, later
  (GAP-CODE-VIEW-PROMOTION below).

### Snapshots

A code view on a page (`render.view` as html, every `ui://kb/view/<id>`
resource) shows what its code draws as of the render, above its text. The
code runs on the server: MCP Apps lets a resource declare connect, resource,
frame and base-URI domains but no `'wasm-unsafe-eval'` or `worker-src`, so
neither engine could run inside a conformant host's iframe. The code view's
figure asks two core references, each a `Reference` that is null by
default, and draws nothing unless both are bound. `kbRuntimeLayer` binds
both:
- `UntrustedEngine` (`@kb/sandbox`) is the engine the code runs on. The
  runtime binds QuickJS, so a snapshot is untrusted whatever this machine
  trusts.
- `ReadInvoke` (`@kb/contracts`) is the invoke core as a read. Every call is
  made as the script's, and a call to a write is refused before the invoke
  core, because drawing a page is a read.

`snapshotRun` waits until the run is quiet (no call
waiting, nothing unread), at most 2 s, and returns the last drawing with the
run's end. As text (`render.view` as md, Claude Code) a code view is its
code, its grant and where it runs.

### The threat model

Each threat, the fences against it, and the tests that pin them.

| Threat | Fences | Pinned by |
| --- | --- | --- |
| Escape from QuickJS | The guest realm is QuickJS's alone, in its own WebAssembly instance per run, reaching the host only through the string pipe; in the browser a second fence, the opaque-origin frame and its CSP; on the server (snapshots) the WebAssembly sandbox alone, with only read actions behind it | contract: no network, no timers, no raw pipe (`sandboxContract`); `kb ui` serves the frame sandboxed (`request-guard.test.ts`) |
| Frame origin and CSP | `sandbox="allow-scripts"` without `allow-same-origin`, repeated as the CSP's `sandbox`; `script-src 'self' 'wasm-unsafe-eval'`, no `'unsafe-inline'` script and no `'unsafe-eval'`; `frame-ancestors 'self'` | `capability.test.ts` (the policy), `request-guard.test.ts` (served with it) |
| postMessage spoofing | The page hears only its frame's own window and decodes every message; the frame hears only its parent; the page posts nothing to a frame that loaded a second document | `sandbox-host.test.ts` |
| Exfiltration | `connect-src`, images, fonts, media, forms and frames `'none'`, inherited by the trusted Worker; the drawing allowlist drops every element and attribute that loads or navigates, so the one navigation a CSP cannot forbid has nothing to start it | `drawing.test.ts`; contract: no network |
| Prompt-injected writes | The grant names every action the code may call; each call meets the policies as `script` (asked before deletes and rewrites, denied trust, a policy write always asks); the guest cannot set `approved` or its actor; a snapshot refuses every write | contract: outside the grant never reaches the invoke core, approval cannot be self-granted; `capability.test.ts`; `approval.test.ts` (runtime); `view-render.test.ts` (a snapshot's write is forbidden) |
| Denial of service | Turn deadline (interrupt, watchdog), heap and stack caps in QuickJS, message rate and size, waiting-call bound, drawing bound, the page's own rate limit on the frame | contract: infinite loop, loop in a handler, memory bomb, flood, oversized, waiting calls; QuickJS heap and stack tests; `sandbox-host.test.ts` (flood) |
| Trust spoofing | The digest is over exactly what runs, computed by the host from the code it runs; trust is local state, per machine, never committed; only a human gesture trusts | `capability.test.ts` (digest covers every character and the grant); `approval.test.ts` (who may trust; an edited digest is untrusted; nothing written to the store); `trust.test.ts` (per machine) |

What the sandbox does not promise: `approved` and the actor are declared,
not proven (GAP [[01M413SP3QSSQJMKKDK3W3J6G8]]); a Worker's heap is not
capped, only its time; QuickJS runs on the frame's main thread
(GAP-SANDBOX-THREAD); and a `graph.query` that the grant allows is bounded in
its result, not in what it costs to run (GAP-SANDBOX-QUERY-COST).

### Gaps

- `// GAP [[01M41DKTE1T51M031N231VGQJR]]` (`@kb/sandbox`'s `index.ts`). Expected: a `#script`
  node attached to a view (`sys.f.scripts` on a view node, ref, many) runs
  in the same sandbox with the same API, plus overlays drawn above the view
  it is attached to and that view's own events (a drop on a board column, a
  hover on a graph node), each a `kb/event` type a view declares. Current:
  only code views run; the API draws only its own box and hears only its own
  drawing's gestures and `data`. Closes: views declaring their events and
  overlay anchors in their keys, a transparent overlay frame over a hosted
  view, and `#script` as a view setting resolved like `sys.f.views`.
- `// GAP [[01M41DKTTRA55RA1KF4QBWQ9MF]]` (`@kb/code`'s `view.ts`). Expected: a
  person promotes a trusted code view to a view type — a `.kb/extensions`
  plugin contributing a `ViewPoint` entry with a key, settings schema and
  catalog entry, committed after review — in the same gesture that trusts
  it, so mode A can then configure it. Current: trust changes the engine
  only; a code view stays a code view. Closes: a promotion action that
  writes the extension module from the view node (code, grant, a params
  schema the person names), and a UI flow that reviews and commits it.
- `// GAP [[01M41DKVB5R21NRCE4T9R4KES1]]` (the frame, `src/sandbox/frame.ts`).
  Expected: untrusted code runs off the frame's main thread, so a turn that
  runs to its deadline never holds the page, even where the browser does
  not give a sandboxed frame its own process. Current: QuickJS runs on the
  frame's main thread, so a turn can hold it for up to 500 ms. Closes:
  QuickJS inside a blob Worker in the frame, with the same engine port.
- `// GAP [[01M41DKVSGG1R5A27Q49SBPHDD]]` (`grant.ts`). Expected: a guest's
  `graph.query` is bounded in time as well as result size. Current: the
  result is bounded; a query that is expensive to evaluate runs to its end
  on the replica (in the browser) or the server. Closes: a deadline in the
  query layer that the invoke core can pass down.
- `// GAP [[01M41DKW6PFA4FX6FRNWBV03ED]]` (`code-page.tsx`). Expected: a person
  edits a code view's code and grant in the view, checked by its key like
  the chart's spec editor. Current: code is written by `view.propose` (an
  agent), or by editing `sys.f.code` as a field. Closes: an editor beside
  the code panel that writes through the key's check.

## Repo integration

- Code `tools/kb/` (repo tooling, not system config). Committed lockfile.
- Data `.kb/` (nodes.jsonl, queries/, views/). Generated docs `docs/kb/`.
- Shell alias `kb` in `modules/common/home-manager/shell.nix`.
- MCP registration via `ai-agents` stack.
- JSONL = intentional repo data → committed, not Mackup.
- Seed: migrate current `TODO.md` items into tagged todo nodes (M5).

## Milestones

- **M1 Core**: model, system-node seed, JsonlStore (+50k benchmark), DataScript adapter, contracts, registry, `node.*`, `graph.query`. bun tests.
- **M2 CLI**: commander wiring, name resolver UX, saved queries (`kb run`), shorthands.
- **M3 MCP**: stdio server, manifest-driven registration.
- **M4 Materialize**: view specs, todos.md view, `docs.check` + pre-commit hook wiring.
- **M5 Integration**: alias, ai-agents MCP wiring, CLAUDE.md section, TODO.md migration.

## Execution: orca orchestration, cursor:claude ≈ 3:1

- M1 first (everything depends on contracts + store). After M1 merges,
  **M2/M3/M4 run fully parallel** in separate orca worktrees — they touch
  disjoint dirs (surface/cli, surface/mcp, operations/docs-*). M5 last on main.
- Worker assignment: **cursor agents** implement M1, M2, M3 (3 workers);
  **claude agent** takes M4 (materialize + hook touches `.githooks`, closest
  to repo conventions). ≈3:1.
- I orchestrate via orca-cli: dispatch, wait on worker_done, run
  `cavecrew-reviewer` on each worktree diff, **fix findings myself**, merge
  sequentially (M1 → parallel trio → M5).
