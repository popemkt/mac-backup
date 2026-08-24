# Brief t1-property-mutation — prove the core with properties, then grade the proof

Harness: omp. Protocol:
`docs/kb-waves/2026-08-24/briefs/impl-protocol.md`.

## The point of the wave

`kb` has ~740 core tests and they are almost all example-based: a hand-picked
input, a hand-written expectation. That suite has repeatedly passed while the
thing it covered was broken — i13 shipped a graph toolbar whose commands
rendered, read correctly, passed every unit assertion, and never landed an
effect. Example tests encode the cases the author thought of, which is exactly
the set of cases where bugs are not.

Two additions close that gap, and they are complementary, not redundant:

- **Property-based tests** state an invariant that must hold for *all* inputs,
  and let a generator hunt for the counterexample the author would not have
  written. They find bugs.
- **Mutation testing** grades the suite itself: it breaks the source on purpose
  and reports which breakages no test noticed. It finds *missing* tests, which
  is the failure mode this codebase actually has.

You are landing both. Mutation testing is the one that tells you whether the
property tests were worth writing, so it is not optional garnish.

## Part 1 — property-based testing (fast-check)

Add `fast-check` as a devDependency of `tools/kb`. Write properties against the
**pure core** — modules with no I/O, where an invariant is stateable. Named
targets, in descending order of value:

1. **`src/foundation/order.ts`** — the ordering algebra. Properties: for any
   sequence of insertions (including at the ends and repeatedly between the
   same neighbours), ranks stay strictly increasing and distinct;
   `ranksFor(ids)` preserves input order; ordering is stable across a
   serialize/parse round trip. Repeated between-insertion is where fractional
   ranking schemes classically die, so generate long adversarial insert chains,
   not three-element examples.
2. **`src/foundation/field-type.ts`** — round trip and idempotence:
   `fieldTypeOf({[fieldTypeField]: [fieldTypeValue(t)]}) === t` for every
   `FieldType`; `migrateFieldTypeValues` is idempotent (applying twice equals
   once) and never changes a node it reports as unchanged.
3. **The ontology resolver** — the algebra is
   `members = ⋃extends ∪ tag-include ∪ explicit-member ∪ query ⊕ closure ∖ exclude ∖ definitions`.
   Properties worth stating: **exclude is absolute** (for any generated
   ontology graph, an excluded id is never a member, no matter which other
   clause would have included it); `extends` is monotone modulo excludes;
   resolution terminates and does not stack-overflow on a cyclic `extends`
   chain; the result is order-independent with respect to how clauses were
   added.
4. **Store round trip** — for any generated valid node set, write to
   `nodes.jsonl` and read back: identical nodes, identical order, no key
   invented and none dropped. This is the "never lose data" invariant and it
   deserves a property, not three fixtures.
5. **Ref/markdown parsing** — `[[id|label]]` extraction round-trips, and
   parsing never loses or duplicates surrounding text.
6. **Seed idempotence** — `systemSeedNodes()` applied to an already-seeded
   store is a no-op; the fill-absent pass never rewrites an existing value.

Write them as `tests/**/*.property.test.ts` so they are discoverable as a class
and can be excluded from a fast loop if they get slow. Keep them under
`bun test` — do not introduce a second core runner.

Constraint that matters: **a property that never fails on a broken
implementation is decoration.** For each of the six, break the implementation
deliberately, watch the property produce a shrunk counterexample, restore, and
paste the counterexample into your handoff. If a property cannot be made to
fail, you have stated a tautology — replace it.

## Part 2 — mutation testing (StrykerJS)

Add StrykerJS, scoped initially to the pure core (`src/foundation/**`), and
commit a config plus a baseline score threshold that CI can ratchet.

The known integration risk, stated up front so you do not discover it as a
surprise: the core suite runs on **`bun test`**, and Stryker's first-class
runners are vitest/jest/mocha. Options, in preference order:

1. Stryker's **command runner** driving `bun test` with `--mutate` scoped to
   `src/foundation/**`. Simplest, no second runner.
2. Stryker's **vitest runner** — `vitest` 4.1.10 is already a devDependency
   and `vp test` uses it. Viable only if the core tests run under vitest
   unchanged; check, do not assume.

Evaluate both with evidence. If neither works acceptably, **say so with the
error output and stop** — do not hand-roll a mutation harness. A bespoke
mutation runner beside Stryker is exactly the parallel mechanism Rule 1
forbids, and a named gap is the correct deliverable in that case.

Wire it as an on-demand/CI script (`npm run test:mutation` or similar), **not**
into `.githooks/pre-commit` — mutation runs are minutes-to-tens-of-minutes and
a pre-commit hook that slow gets bypassed with `--no-verify`, which costs you
the hook entirely.

Report the actual mutation score and, more usefully, **the survivors**: list
the mutants that no test killed, because that list is the real output of this
wave. Where a survivor reveals a genuine coverage hole that one of your Part 1
properties should have caught, close it and say so.

## Zone

Yours: `tools/kb/tests/**`, `tools/kb/stryker.config.*` (new),
`tools/kb/package.json` (devDeps `fast-check` + Stryker, and the scripts for
them — **g1 also edits this file; keep your edits contiguous and minimal**),
and your report.

Not yours: `tools/kb/src/**` except where a property exposes a real bug — in
which case fix the bug, keep the fix minimal, and call it out in the handoff as
a found defect (that is a wave success, not scope creep).
Not yours: `.oxlintrc.json` / `knip.json` (g1), the clock/id seams in
`src/foundation/model.ts` (t2), `ui/**` (s1).

## Acceptance

- `fast-check` properties covering all six targets, each demonstrated red on a
  deliberate break with the shrunk counterexample recorded.
- Any real defect the properties found is fixed, or named as a gap if the fix
  is outside your zone.
- StrykerJS configured, running, scoped, with a committed threshold and a
  documented score — or a documented, evidenced refusal per the escalation
  above.
- Mutation survivors enumerated in the report.
- Mutation is NOT in pre-commit.
- Four-command verification green, counts reported.
