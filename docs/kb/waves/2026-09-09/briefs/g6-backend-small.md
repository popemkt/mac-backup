# g6-backend-small — eight small gaps with exact `closes` lines, done as written

Wave `g6` of `docs/kb/waves/2026-09-09/plan.md`. Harness: claude. Branch
`kb-g6-backend` from **`kb-merge-origin`**. Run `intent/gate.sh session claude`
first. Read each gap node (`bun tools/kb/packages/app/cli/src/main.ts get
<id>`) — each already states `expected`, `current`, `closes`; the `closes`
line is the spec, this brief only orders them and names the boundaries.

You own: `tools/kb/packages/application/operations/**`,
`tools/kb/packages/app/server/**`, `tools/kb/packages/app/ui/src/api/ws*` and
its fakes, `ui/src/lib/palette-index.test.ts`, the two store methods in
`ui/src/stores/outline.store.ts` and their test assertions, `.gitattributes`
+ a new merge-driver script under `tools/kb/scripts/` (or wherever the repo's
Bun scripts live — look first), and **one option** in `.oxlintrc.json`
(gap 8). Nothing else in `.oxlintrc.json`; no baseline edit unless a count
moves, then `bun run harness:snapshot` and say why. Not yours: canvas (g3),
outline keymaps/palette (g4), graph seed (g1). Known red you do not touch:
`kinds.test.ts` (g1).

## Gaps, in order (smallest blast radius first)

1. `01M1R19NXBMTVQG6AH0S7VTC7D` — a UI test gates on wall-clock time
   (`palette-index.test.ts`, 50k-node keystroke <10ms). Keep the algorithmic
   assertion; make the timing an observation (print) or a calibrated ratio.
   The k1 worker saw this flake once on a loaded machine.
2. `01M1MGT3K0DNGEQFXQNZYE83NY` — `getPreviousVisibleNode` /
   `getNextVisibleNode` exposed by node id. Confirm no caller outside the
   test (`grep -rn` across `packages/app/ui/src`), delete both and their two
   assertions. The gap says "owner call"; the owner has asked for outstanding
   gaps to be fixed, so it is authorized.
3. `01M1MHKS8EV3DD378TZSX44EJG` — the ws client assigns `on*` handlers.
   Widen `WsLike` to `{addEventListener, removeEventListener, send, close}`;
   update every injected fake.
4. `01M1MFS8RQ2BMQVZD02J4TQT7W` — seven terminal `.then` callbacks disable
   `promise/always-return`. Set `ignoreLastCallback: true` on the rule in
   `.oxlintrc.json` (verify oxlint honours it in the pinned version — run the
   lint, do not assume), then delete the seven `oxlint-disable-next-line`
   lines. If the option is not honoured, stop on this gap and report.
5. `01M1M08WYY9X6HFNN5GKDCC47E` — `.kb/nodes.jsonl` has no merge driver. A
   Bun script that does what the coordinator did by hand today: three-way by
   node id; a side that equals base yields; both-changed → newer `updatedAt`;
   a side's deletion of a base-identical node is honoured; output sorted by
   id, `JSON.stringify` with sorted keys, no spaces, trailing newline —
   i.e. `canonicalJsonl` from `@kb/test-kit` or the model's canonical writer,
   whichever is the production one; do not write a third serializer. Wire it
   in `.gitattributes` for both `.kb/nodes.jsonl` and `tools/kb/.kb/nodes.jsonl`
   plus the `git config merge.kb-jsonl.driver` line documented in
   `tools/kb/AGENTS.md` next to the hooks-path line (git config is per-clone;
   say so). Tests: the three cases above plus "both changed, ours newer" and
   "conflict-free merge leaves file byte-identical to `git merge-file` result
   when only one side changed".
6. `01M1PJSSQYFV2E160JANGBPKCK` — the action registry does not validate output
   schemas. One output parser for Effect-native and Promise handlers; a
   mismatch maps to an internal contract failure receipt (typed code, never
   a throw across the boundary); red tests for an invalid output on each
   handler kind.
7. `01M1PK5NYA7ZG3XC0H0YRYRVZE` — store staleness is size+mtime. Read the gap
   and `EffectStore.fingerprint` (s1 added it: `revision:` for memory, and
   the JSONL/sqlite adapters have theirs). Persist reconciles against the
   store's fingerprint, not `stat`. If the two adapters' fingerprints already
   satisfy the gap's `closes`, the fix is the reconcile site alone; say what
   you found.
8. `01M1QZNM17MTGGPE517NVZYJT0` — subscription re-evaluation is
   O(clients × subs × full query) per tx. Key the evaluation by query string
   so a shared query runs once per tx; gate on the tx touching an attribute
   or entity the query reads **only if** the IR already exposes that read set
   (check `@kb/query`'s IR); otherwise do the first half, leave the second as
   the gap's remaining `closes`, and say so.

Every gap you close: `status=done` via the CLI, `// GAP [[id]]` markers off.
A gap you half-close: leave open, rewrite its `current` and `closes` to the
new truth (unset the old value first — props are multi-valued).

## Rules

No `.skip`, no new `oxlint-disable`, no baseline edits (except a legitimate
snapshot for gap 4's seven removals — which should *lower* a count, not raise
it). One commit per gap, `fix`/`refactor`/`feat` as fits, last commit
`chore(kb): close backend gaps` with statuses and regenerated docs.

Gates before each commit, from `tools/kb`: `bun run verify`, `bun test
packages` (only the 3 known fails), `bun run test:ui`. Background commits.

## Ownership answers

Files above: yes. `.gitattributes` and one `.oxlintrc.json` option: yes.
Store API deletions in gap 2: yes. Anything else: smallest call, record,
continue.

## Report

`docs/kb/waves/2026-09-09/reports/g6.md`: per gap, closed / half-closed / not
and the commit; the merge driver's cases and the exact `git config` line;
whether oxlint honoured `ignoreLastCallback`; what the fingerprint site
looked like; test output; "Calls I made".
