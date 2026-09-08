# h1-ui-test-isolation — a red UI run means a defect, not a busy machine

Wave `h1` of `docs/kb/waves/2026-09-10/plan.md`. Harness: claude (opus).
Branch `kb-h1-ui-tests` from `main`. Run `intent/gate.sh session claude`
first. Read each gap node (`bun tools/kb/packages/app/cli/src/main.ts get
<id>`), then `packages/app/ui/vite.config.ts` (the `test:` block — three
lines today), `ui/src/test-setup.ts`, `ui/src/test-support/**`,
`components/outline/editor-behavior.test.tsx` and
`components/outline/use-node-keydown.characterization.test.tsx` (the pair the
gap says reproduces it), `lib/palette-index.test.ts` (the perf bar),
`packages/app/test-kit/tests/dst.test.ts`, and gap
`01M1R19NXBMTVQG6AH0S7VTC7D` (done — the same class, and how it was closed).
`docs/kb/waves/2026-09-09/plan.md` → close-out lists every flake the last
wave saw and confirmed green in isolation; that list is your regression set.

You own: `packages/app/ui/vite.config.ts` (`test:` block only),
`ui/src/test-setup.ts`, `ui/src/test-support/**`, every `*.test.ts(x)` and
`*.characterization.test.tsx` under `ui/src`, `test-kit/tests/dst.test.ts`,
`tools/kb/package.json` test scripts, your report. `ui/src/actions/mutations.ts`
**only** if the root cause is there (see gap 1) and the change is
behaviour-preserving for every caller. **Not yours**: any component, store,
or lib source file; `harness/src/constraints.ts`; `.oxlintrc.json`; the
baseline except `bun run harness:snapshot` when a count drops. h2 is
working `field-value.tsx`, `node-content.tsx`, `canvas-card.tsx` in
parallel — do not touch them, and expect their tests to still pass under you.

## Gaps

1. `01M1XA98A0A7PWEPMHG2T4R5GP` — concurrent UI test files share the store.
   **Diagnose before you fix.** The gap's `current` states a mechanism
   ("workers share module state; a fire-and-forget `void mutations.X().then`
   still in flight lands in a neighbour's store"). Vitest isolates module
   registries per file by default, so that mechanism is a hypothesis, not a
   finding. Establish the real one with evidence: reproduce the red pairing
   (`vp test <fileA> <fileB>` with and without `--no-file-parallelism`, ten
   runs each, record the counts); instrument — print `process.pid`,
   `worker id`, and a per-module nonce from `test-setup.ts` and from the
   store module — to show whether two files ever observe the same store
   object, or whether the reds are timing (a `waitFor`/`act` budget, fake
   timers, an unawaited promise resolving *within* the file after its own
   assertion) that load merely exposes. Then fix at the root:
   - if isolation is genuinely off (check what `vite-plus`'s `vp test`
     defaults to for `pool`, `isolate`, `fileParallelism`): turn it on in the
     `test:` block, with the reason as a comment, and measure the wall-time
     cost of the full UI run before/after;
   - if the leak is within-file (a chain outliving its test), the fix is a
     drain helper in `test-support/` that every DOM suite's `afterEach` calls
     — one helper, not a copy per file — or, if `mutations` genuinely fires
     and forgets in a way no test can await, make the affected mutation(s)
     return their hand-off so callers *can* await. That second option touches
     `actions/mutations.ts` and is the only reason it is in your ownership;
     take it only if the evidence points there;
   - if the reds are pure load timing, size the budget in the file with its
     reason (the `01M1R19NXBMTVQG6AH0S7VTC7D` shape) and say so — that
     re-scopes the gap, so rewrite its `current` (unset then set).
   Also in this gap: `lib/palette-index.test.ts`'s 10 ms keystroke bar.
   Either it becomes an algorithmic assertion plus a printed observation
   table (the closed gap's shape), or it moves into its own sequential lane
   (`test:ui:perf` script, excluded from `test:ui`'s include). Pick the
   first unless the bar is the only thing the test proves.
2. `01M1X8VQT1P6E45NBTQEQ96YDR` — DST scenarios gate on bun test's 5000 ms
   default. State the timeout in the file with its reason, sized to a loaded
   machine (measure: run `bun test packages` while `bun run test:ui` is
   running, three times; the budget is the max observed × a stated factor),
   or make the scenario count adaptive. The number and its reason live in
   `dst.test.ts`, not in a runner flag.

## Proof

The gate for this wave is statistical, not one green run. Before your fix
and after it, run the full `bun run test:ui` **five times under load**
(`bun test packages` running concurrently each time) and record pass/fail
per run with the failing test names. Same for `bun test packages` five
times under `bun run test:ui`. After: 5/5 and 5/5, or the report says which
suite still reddens and why that is outside your ownership.

## Rules

- No `.skip`, no `.todo`, no new `oxlint-disable`, no baseline edits.
- No test loosens its assertion to pass. A budget may be sized; a property
  may not be weakened. If a test is asserting the wrong thing, say so in
  the report and leave it.
- Every gap you close: `status=done` via the CLI, `// GAP [[id]]` markers
  off. A re-scoped gap keeps its id and gets a new `current`/`closes`.

## Commits

1. `test(kb-ui): characterize cross-file store leakage under parallelism`
   (the instrumentation and the counts, as a test or a script under
   `test-support/`, committed so the next reader can rerun it)
2. `fix(kb-ui): …` — the root-cause fix, named for what it actually was
3. `test(kb-ui): palette-index asserts the algorithm and prints the timing`
4. `test(kb): DST scenarios carry an explicit, reasoned timeout`
5. `chore(kb): close test-isolation gaps` — statuses, docs regenerated.

Gates before each: `bun run verify`, `bun test packages`, `bun run test:ui`.
Background commits (pre-commit takes minutes).

## Ownership answers

Files above: yes. `mutations.ts` per gap 1: yes, only with the evidence.
Any other source file: no — report the seam. Anything else: smallest call,
record, continue.

## Report

`docs/kb/waves/2026-09-10/reports/h1.md`: the diagnosis with its evidence
(the pairing counts, the instrumentation output); the root cause in one
sentence; the fix and why it is at the root; UI-run wall time before/after
if config changed; the 5×/5× load matrices before and after; palette-index
and DST shapes; test output; "Calls I made"; gaps closed / re-scoped.
