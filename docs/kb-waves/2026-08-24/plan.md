# Wave 2026-08-24 — guardrails, test rigour, Effect decision, Storybook

Owner mission, verbatim:

> 1. implement the guardrails mentioned in
>    `docs/kb-waves/2026-08-23/reports/i11-lint-report.md`
> 2. Make this tool ready for mutation testing, deterministic simulation
>    testing and properties based testing.
> 3. are we using effect throughout. If not, plan something, don't do it yet.
> 4. Are we using storybook? if not please do add it.

Delegated. Delegate pool, owner-ranked: **opencode, omp** (preferred, ~2 in
every 3), then cursor, codex, claude.

## Split

| Wave | Item | Harness | Deliverable |
|---|---|---|---|
| `g1-guardrails` | 1 | opencode | oxlint rules with teeth, knip, `verify`, CSS override, three `any` leaks closed |
| `t1-property-mutation` | 2a | omp | fast-check properties over the pure core + StrykerJS with a committed threshold |
| `t2-dst` | 2b | opencode | one owner for time and randomness, seeded replayable simulation harness |
| `s1-storybook` | 4 | omp | Storybook 9, six hand-rolled catalog modules migrated to CSF3, outline coverage |
| `r1-effect-plan` | 3 | cursor | audit + phased plan. **Research only — no code.** |

4 of 5 to opencode/omp, per the owner's ranking.

Item 2 is split because it is two different jobs. t1 grades and strengthens the
existing example-based suite; t2 removes nondeterminism from the system so a
history can replay. They share no files.

## Why item 2 is two waves, not one

Property-based testing finds bugs the author did not think of. Mutation testing
finds *tests the author did not write* — it grades the suite. DST makes rare
interleavings and long-horizon corruption reproducible from a seed. The first
two are test-authoring work against pure modules; the third is a plumbing change
to production code (`nowIso`, `ulid`). Same file set would have collided; the
concerns are genuinely separate.

## Conflict management

- `tools/kb/package.json` — **g1 owns it.** t1 must also add `fast-check` and
  Stryker there; both were told to keep edits contiguous and minimal.
  Expect one mechanical conflict at merge.
- t2 is forbidden from touching `package.json` at all; it uses Effect's already
  vendored `Clock`/`Random`/`TestClock` instead of adding a dependency.
- s1 owns `ui/package.json` alone.
- g1 is closing `any` in `ui/src/api/ws.ts`,
  `ui/src/components/graph/force3d-three.ts`,
  `ui/src/components/canvas/canvas-page.tsx`; s1 is barred from those three.
- r1 writes one markdown file and nothing else.

Merge order: `g1` → `t1` → `t2` → `s1`. r1 merges whenever; it is docs only.

## Cross-wave dependency

t2's output — the list of call sites it had to thread manually because they are
not yet in Effect — is the most valuable input to r1's plan. r1 is instructed to
consume it and to treat t2's seam as phase 0, rather than re-planning it.

## Base state

Base commit: `28d0e79`. Baselines the workers must not regress:
core **740** pass, typecheck clean, `vp check` clean, UI **510** pass.

Known pre-existing failures at base, declared to every worker as not-theirs:
three render specs in `ui/tests-render/graph.e2e.ts` (force2d and force3d
report zero nodes, cluster never switches).

`.kb/nodes.jsonl` is dirty on main with owner data. No worker touches it.

## Standing constraints given to every worker

Rule 1 (`AGENTS.md`, abstraction before addition) outranks everything, and this
wave is unusually exposed to its specific failure mode: four of the five waves
add tooling, and tooling added beside an existing mechanism is how a repo ends
up with two linters, two story formats, two clocks, and two mutation runners.
Each brief names the parallel mechanism it must not create, and each says that
the correct output when the clean version does not fit is a named gap, not a
stopgap.

Second standing rule, stated in the protocol: **a rule or test that has never
gone red is not known to work.** Every worker owes red-then-green evidence for
anything they add that is meant to catch a defect.
