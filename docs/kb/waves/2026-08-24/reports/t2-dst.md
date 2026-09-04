# t2-dst handoff — one owner for time and randomness, then replayable histories

Harness: opencode. Branch: `popemkt/kb-t2-dst`. Zone honored; no push, no merge,
no `rtk rebuild`, no `.kb/nodes.jsonl` edits.

## What shipped, per acceptance criterion

### 1. Time and randomness each have one owner, and a guard test fails on a bypass

**Owner = Effect's `Clock` and `Random` services**, exposed from
`tools/kb/src/foundation/model.ts` (Rule 1: no parallel capability record — the
already-vendored Effect services *are* the capability; the harness overrides
them). The seam: `currentIso` (an `Effect<string>` reading `Clock.currentTimeMillis`)
and `freshId` (an `Effect<NodeId>` drawing a seeded ULID from `Random.Random` +
the active `Clock`). Added `isoFromMillis` as the single ISO-format point and
hardened `freshId` against the `ulid()` library's `!seedTime → Date.now()` fallback
(coerce 0 → 1) so an epoch-0 clock still replays.

**Guard test** `tools/kb/tests/dst/guard.test.ts` greps all of `src/**` for
`Date.now(`, `Math.random(`, `new Date(`, `ulid(`, `nowIso(`, `Date(` and fails
if any appears outside the seam owner (`model.ts`) plus the documented
exceptions (`seed.ts`/`example.ts` use `nowIso()` only as a *defaulted* param;
`write-lock.ts`/`durable-replace.ts` use `Date.now()` only for lock-spin timing
and a tmp-file name — neither writes node content).

**Red then green** (guard test):

```
# DELIBERATE BYPASS — added `nowIso()` + `ulid()` back into nodeAddEffect
error: ulid( in operations/index.ts (allowed only in: model.ts)
nowIso( in operations/index.ts (allowed only in: model.ts, seed.ts, example.ts)
(fail) determinism seam guard > no store-reachable file reads time/randomness outside the seam owner
# after removing the bypass
 1 pass
```

### 2. Four-command suite green with the seam in place

- `bun test` (core): **751 pass / 0 fail** (baseline 740; +11 DST tests)
- `npm run typecheck` (`tsc --noEmit`): **0 errors**
- `npm run check` (`vp check --no-fmt`): **0 warnings / 0 errors, 93 files**
- `cd ui && ./node_modules/.bin/vp test`: **510 pass / 0 fail**

Timestamps did not become order-dependent: the seed system nodes and each
write op now use the real live `Clock` on the production path (identical to
before), and the harness installs its own deterministic clock only inside the
simulation. Core tests that assert byte-stability on reopen (`core.test.ts`
"created on first init and idempotent") still pass.

### 3. Seeded harness in tests/dst/, real plan/apply path

`tools/kb/tests/dst/`:
- `harness.ts` — `runScenario(seed, {ops})` opens a fresh temp store via
  `openKbEffect`, then for each op draws a `PlannedAction` from the **real plan
  surface** (`mapAdd`/`mapSet`/`mapUnset`/`mapMv`/`mapRm`/`mapFieldDefine`/
  `mapTagDefine` — the same module the CLI uses) and applies it through
  `invokeReceiptEffect` (the same `ActionHandlerEnv` the CLI/UI/MCP use). Not a
  test-only shortcut. Runs under `Random.withSeed(seed)` + a deterministic
  `seededClock(base, step)`.
- `dst.test.ts` — committed seeds (`dst-0..3`, always in CI).
- `run-many.ts` — `bun tests/dst/run-many.ts N` for many seeds on demand.

**Invariants asserted continuously after every op** (on the on-disk store, via
sync read): no node references a missing *structural* child; single parent; `order`
ranks per sibling/root group are unique and strictly increasing after migration;
`txIntegrityError` agrees the graph is legal; `sys.*` write guards hold; and the
store round-trips to identical canonical bytes (the real "no prop key invented or
silently dropped" guard). `run-many` output (widely sampled):

```
ok   seed=dst-0 ops=60 nodes=99 bytes=22050
ok   seed=dst-many-5  ops=60 nodes=97 bytes=22016
ALL 28 SEEDS GREEN
```

### 4. Same-seed replay is byte-identical — demonstrated

`dst.test.ts` "same seed replays to a byte-identical store" runs every committed
seed twice and asserts `a.json === b.json`. Independently verified end-to-end
through `invokeReceiptEffect` (the identical property held on the very first
prototype before the harness existed): the full store bytes matched.

### 5. A deliberately introduced bug is caught, with seed + op index

**Red (deliberate bug injected into `insertChild` to stamp a fixed colliding
`order` rank):**

```
seed: dst-3
ops applied before failure: 41
violation: op#41 (seed dst-3): ordering ranks collide at (root): zr8r8r8r88, …, 1000000000, …, 1000000000, …
```

One line reproduces the failure: `seed dst-3`, `op#41`. Important framing: this
**specific** bug is caught by the ordering invariant, not by replay divergence —
because the bug is deterministic, replay stays identical under the same seed; the
invariant (which the store's own `txIntegrityError` never checks — it never
inspects `order`) is what catches it. That is precisely the harness's value: it
asserts properties the store doesn't. After restoring the clean code, all DST
tests pass again (green shown in §2).

### 6. Dangling-ref decision — made, encoded, justified

**Decision: dangling *inbound content* refs are intended behaviour, not a
violation. Dangling *structural* children are a violation.**

`rm` (cascade) deletes a node and its subtree. Any *other* node that still
carries an inbound reference to it — a `{t:"ref"}` prop value, a `[[id|label]]`
mention in text, or (surfaced by the harness) a **prop key naming a deleted field
node** — is left dangling. The resolver degrades these to a string sentinel rather
than dropping them (`query/datascript.ts` `propDatomValue`).

Rationale: deleting a node must never silently rewrite another node's content
(text can't be edited behind the user, prop values aren't erased, and an
orphaned prop key still round-trips). So the store is fully legal with such refs
present; the resolver warns. The harness encodes the split: `DANGLING_REF_DECISION`
documents it, `contentDanglingRefs()` enumerates the tolerated kinds, and
`invariantViolations()` checks only structural edges + ordering + round-trip. The
factory-derived invariant "no prop key invented or silently dropped" is therefore
enforced as **round-trip byte-stability** (a new/vanished key on reload is the
asymmetry that matters), which is asserted continuously in the runner.

This was a genuine finding, not papered over: the harness initially flagged a
node carrying a prop key to a deleted field node as a violation before I decided
it belongs in the tolerated bucket. The seed that exercises it now runs clean.

### 7. Every not-yet-Effect call site threaded manually, for `r1-effect-plan`

These are the sites where time/identity is obtained without the code being a
plain Effect service call yet. The brief's remit was "time and identity only" —
I threaded the capability (a value/param where the effect is already structured)
rather than converting them, and did **not** start a broad Effect migration.

| Site | Kind | What I did |
|---|---|---|
| `foundation/seed.ts` `systemSeedNodes(at = nowIso())` | pure seed builder | kept `nowIso()` as the **live default** (thread-the-param pattern); Effect caller (`services.ts` `openKbEffect`) now threads `yield* currentIso` |
| `foundation/seed.ts` `ensureSystemSeed(nodes, at = nowIso())` | pure, called by Effect | added `at` param defaulted to live; `openKbEffect` threads the clock |
| `foundation/example.ts` `exampleSeedNodes(at = nowIso())` | pure seed builder | kept live default; Effect caller (`cli.ts` init) now threads `yield* currentIso` |
| `operations/index.ts` `insertChild`/`detachFromParents` | sync helpers inside Effect fns | added `at: string` param; callers (`nodeAddEffect`/`nodeUpdateEffect`) pass the clock time they already resolved |
| `foundation/storage/write-lock.ts` `Date.now()` | lock spin timeout | **left as-is** — it is I/O timing, not node content; excluded from the guard (documented) |
| `foundation/storage/durable-replace.ts` `Date.now()` | tmp-file name | **left as-is** — I/O only; excluded from the guard (documented) |

## What was cut and why

- **No broad Effect migration.** Time and identity only, per the brief. The two
  pure seed builders and the two storage-I/O `Date.now()` uses were
  thread-the-param / document-and-exclude rather than converted.
- **No oxlint rule** for the guard. `.oxlintrc.json` / `knip.json` are g1's; the
  brief permits a grep-based test even if an oxlint rule would be preferred. I put
  the guard in a test (`tests/dst/guard.test.ts`) and left the rule text out of
  g1's file. (If the orchestrator wants, the rule can be lifted from the guard's
  token list.) The gate tool reported `SOFT_MISSING: shellcheck actionlint
  nvfetcher` (exit 0) — non-blocking.
- **No `tools/kb/package.json` edit** (t1 owns it). The seam uses only
  already-vendored `effect` + `ulid`; no new dependency.

## Shared-file touches (for clean merge)

| Path | Why |
|---|---|
| `tools/kb/src/foundation/model.ts` | the seam owner (`currentIso`, `freshId`, `isoFromMillis`, hardened `nowIso`) |
| `tools/kb/src/foundation/seed.ts` | `ensureSystemSeed`/`systemSeedNodes` accept an `at` param defaulted to live |
| `tools/kb/src/foundation/services.ts` | `openKbEffect` threads `yield* currentIso` into seeding |
| `tools/kb/src/operations/index.ts` | `nodeAddEffect`/`nodeUpdateEffect` resolve `at`/id from the seam; helper fns take `at` |
| `tools/kb/src/operations/assets.ts` | `assetUploadEffect` draws its id from `freshId` |
| `tools/kb/src/surface/cli.ts` | init example seeding threads `yield* currentIso` |
| `tools/kb/tests/dst/**` | new (harness, guard, committed seeds, run-many) |

No conflicts expected with t1 (`package.json`) or g1 (`.oxlintrc.json`/`knip.json`).
`operations/index.ts` and `seed.ts` are the most likely to touch a sibling t1
line; the edits are small and localized to imports/params.

## Follow-ups

- **`r1-effect-plan`**: the hand-threaded sites in §7 are direct input. The two
  pure seed builders become Effect when seeding moves into an Effect service;
  `write-lock.ts`/`durable-replace.ts` `Date.now()` should move to `Clock`- or
  monotonic-time-backed elapsed measurement in a storage-IO pass.
- **Ordering in live ops**: `insertChild`/the reorder branch position the
  `children` array but never assign `order`; ranks only materialise at
  `migrateOrderKeys` on open. A delete/reorder that leaves a colliding rank is
  invisible to the store's tx-validation and detectable only by the DST ordering
  invariant (#5 evidence). Worth a store-side guard later (out of my zone).
- **Field-node deletion**: prop keys dangle when the field node is deleted. The
  current decision tolerates it (round-trip-stable, resolver warns). If the owner
  wants a hard invariant here, that is a separate semantic call — flagged, not
  silently adopted.

## Self-grade, gaps honestly named

- The guard is grep-based and token-listed, so it stays green as long as a new
  nondeterminism source is spelled with one of the covered tokens. A source using
  a new primitive (e.g. `performance.now()`, `crypto.getRandomValues` ) would need
  the token list extended. The seam is the real guard; the grep is a tripwire.
- `run-many.ts` samples many seeds but `dst.test.ts` runs only four committed
  seeds in CI (by design, per "small committed set"). The 28-seed sweep was run
  manually and is green; CI stays fast.
- The ordering invariant checks uniqueness+strictness on the *migrated* view, not
  the live `children` array (which carries no ranks until migration). This is the
  correct thing to assert (it is what a reopen would produce), but it means a live
  ordering bug only surfaces after a migrate — which the harness triggers on every
  snapshot, so it does not hide.
- The harness's op generator is tuned to be valid-biased but does occasionally hit
  failure edges (e.g. stale field name). Failed ops are tolerated (the store stays
  legal) and are not treated as defects; a receipt-fail that *also* leaves the
  store illegal would be caught by the structural invariants.

## Commits

- `473701c feat(kb): single owner for store time + identity via Effect Clock/Random`
- `215bc47 test(kb): seeded DST harness over real plan/apply + determinism seam guard`
- `8503ba0 test(kb): encode dangling-ref decision — content refs tolerated, structural not`
- `40b7fc4 chore(kb): remove scratch probe from tests/dst`

No push, no merge into main. Ready for the orchestrator's merge (order per
protocol: `g1 → t1 → t2-dst → s1`).
