# Brief t2-dst — one owner for time and randomness, then replayable histories

Harness: opencode. Protocol:
`docs/kb/waves/2026-08-24/briefs/impl-protocol.md`.

## The point of the wave

Deterministic simulation testing means: generate a whole *history* of operations
from a seed, run it against the real system, and get a bit-identical result
every time — so that when a run fails, the seed alone reproduces it. FoundationDB
and TigerBeetle are the reference examples. The payoff is that rare interleavings
and long-horizon state corruption become reproducible instead of anecdotal.

You cannot have that while the system reads the wall clock and a random id
generator at arbitrary depths. So this wave is 80% plumbing and 20% harness, in
that order, and the plumbing is the part that must be clean.

## Part 1 — collapse time and identity to one owner each

Today, nondeterminism enters through at least:

- `nowIso()` in `src/foundation/model.ts`, called at node creation and update
- `ulid()` for id generation (monotonic on wall time, so doubly nondeterministic)
- any direct `Date.now()` / `new Date()` / `Math.random()` reachable from the
  store or action paths

Find every source; do not trust that list to be complete. Then give time and
randomness **one owner each**, and route every call site through it. This is a
Rule 1 job: the failure mode to avoid is a `DeterministicClock` used by the
harness while production code still calls `nowIso()` directly. If any call site
bypasses the owner, the seam is decorative and the harness will silently
diverge — so your acceptance includes a test that fails if a bypass exists
(a grep-based guard test, or an oxlint `no-restricted-syntax` rule, is fine and
preferred over hoping).

**Use what is already here.** `effect` 4.0.0-beta.106 and
`@effect/platform-bun` are already dependencies and 24 of 57 backend modules
already import them. Effect ships `Clock`, `Random`, and `TestClock` — that is
precisely this capability, already vendored. Prefer them over inventing a
parallel capability record.

Where a call site is not yet in `Effect`, thread the capability explicitly
(one parameter, defaulted to the live implementation) rather than reaching for
a module-level mutable global or a monkeypatch. Record every such site in your
handoff: that list is direct input to the Effect adoption plan being written in
parallel (`r1-effect-plan`), and it is the most valuable thing you produce for
it. **Do not start a broad Effect migration yourself** — the owner has asked
for that to be planned before it is done. Your remit is time and identity only.

## Part 2 — the simulation harness

Build a seeded scenario runner that:

1. Takes a seed, and from it generates a sequence of store operations drawn
   from the real action/plan surface — node add, edit, move/reorder, tag,
   set/unset prop, delete, and whatever else the plan layer exposes. Use
   Effect's seeded `Random`; do **not** add a dependency for this and do **not**
   hand-roll a PRNG.
2. Applies them through the real code path — the same plan/apply the CLI and UI
   use, not a test-only shortcut. A simulation that bypasses production code
   proves nothing about production code.
3. Asserts invariants continuously, not just at the end. At minimum: ordering
   stays total and strictly increasing; no node references a parent that does
   not exist; `nodes.jsonl` stays parseable and round-trips; no prop key is
   invented or silently dropped; `sys.*` write guards hold.
4. **Replays identically.** Same seed ⇒ byte-identical final store. Assert this
   explicitly; it is the property that makes every other assertion debuggable,
   and it is the one that will catch a leftover nondeterminism source.
5. On failure, prints the seed and the operation index, so the failure is a
   one-line reproduction.

Land it at `tests/dst/` with a small committed set of seeds that always run in
CI, and a way to run many seeds on demand.

Known gap you should surface rather than paper over: `rm` currently leaves
dangling inbound refs (the resolver warns rather than dropping them). Decide
whether that is an invariant violation or intended behaviour, encode the
decision as an assertion either way, and say which you chose and why.

## Zone

Yours: `tools/kb/src/foundation/model.ts` and whatever minimal call-site
threading the seam requires across `tools/kb/src/**`; `tools/kb/tests/dst/**`.

**You may not edit `tools/kb/package.json`.** If you believe you need a
dependency, stop and record it in the handoff — the whole point of using
Effect's `Clock`/`Random` is that you do not. (t1 owns that file this wave.)

Not yours: `ui/**`, `.oxlintrc.json` / `knip.json` (g1) — except that if you
want the bypass guard as an oxlint rule, write the rule text in your handoff for
g1/the orchestrator to land, or put it in a test instead.
Not yours: `tests/**/*.property.test.ts` (t1).

## Acceptance

- Every wall-clock and randomness source reachable from the store has exactly
  one owner, and a test fails if a new bypass is introduced. Demonstrate that
  test going red by adding a bypass, then remove it.
- The four-command suite still green with the seam in place — timestamps in
  existing tests must not have become order-dependent.
- Seeded harness in `tests/dst/`, running the real plan/apply path, asserting
  the invariants above continuously.
- Same-seed replay produces a byte-identical store; demonstrated.
- A deliberately introduced bug (e.g. break ordering on delete) is caught by
  the harness, with the failure output showing seed + op index. Paste it.
- The dangling-ref decision made, encoded, and justified.
- Every not-yet-Effect call site you had to thread manually, listed for
  `r1-effect-plan`.
