# g9-harness — the suppression grammar is one grammar; the import graph sees every edge; admission reads what will be committed

Wave `g9` (batch 3) of `docs/kb/waves/2026-09-09/plan.md`. Harness: claude.
Branch `kb-g9-harness` from **`kb-merge-origin`** (batches 1 and 2 merged).
Run `intent/gate.sh session claude` first. Read each gap node
(`bun tools/kb/packages/app/cli/src/main.ts get <id>`), then
`tools/kb/harness/tests/suppression-grammar.test.ts` (the `.skip` you are
unskipping and its `GAP [[…]]` pairing — `skip-pairing` is the check that
enforces that pairing, so removing the skip and the marker is one edit),
`tools/kb/harness/src/` (`import-graph`, `constraints`, `suppression`),
`tools/kb/harness/tests/import-graph.test.ts`, `.githooks/pre-commit`,
`intent/gate.sh`, and `docs/ci.md` (what the hook and CI gate, and why).
`CLAUDE.md` → "Drift markers and gaps" is the grammar's canonical statement.

You own: `tools/kb/harness/**` (tests and src, **except** the `UI_ALLOWS` /
`LAYER_ALLOWS` / `SCOPE_ALLOWS` matrices in `constraints.ts` — reading them is
fine, changing them is not), every `// eslint-disable…` comment in
`tools/kb/packages/**` (comment-line rewrites only, no code changes in those
files), `.githooks/pre-commit`, `docs/ci.md` and the kb `AGENTS.md` paragraph
that describes admission, your report. Batch 3 runs alone, so there is no
concurrent worker to collide with; that is why it waited.

## Gaps

1. `01M1PHTZDZCKMXYP6HW109M3DT` — suppression grammar still includes legacy
   eslint directives. Ten `eslint-disable` comments remain under
   `tools/kb/packages` (grep to confirm the current list — the gap's file
   list predates two waves). Rewrite each to the oxlint grammar the test
   expects: `// oxlint-disable-next-line <rule> -- GAP [[<node-id>]]` for a
   sanctioned site, or **delete** it if the rule no longer fires (run lint
   with `--report-unused-disable-directives-severity=error`, which `verify`
   already does — an unused directive is an error, so the lint tells you).
   A directive that sanctions a real breach with **no** gap node is not
   rewritten to a fake id: file the gap (`kb add "GAP: …" --tag gap --create
   --prop expected=… --prop current=… --prop impact=… --prop closes=…`) and
   cite it. Then unskip the test and remove its `GAP` pairing comment.
   `react/exhaustive-deps` disables that g2 preserved are in scope: same
   treatment.
2. `01M1PJV94AJP2SAQT50KNKNHA2` — the import graph misses package-entry
   bypasses. `importEdges` creates workspace edges only for exact bare
   `@kb/<package>` specifiers and scans only `.ts`/`.tsx`. `closes`: resolve
   relative and subpath specifiers to package ownership (a relative import
   that leaves its package directory is a workspace edge; a
   `@kb/<pkg>/src/...` subpath is an edge to `<pkg>` **and** a
   `public-surface` breach), govern `.js`, `.jsx`, `.mts`, `.cts`, and add a
   **red test for every bypass** — a fixture tree per case, asserting the
   edge is found and, where applicable, that `boundaries` fails on it. If the
   real tree turns out to contain a bypass once the graph can see it, that is
   a finding: fix the import if it is one line, otherwise file the gap and
   mark the site with the grammar from gap 1. Do not widen a matrix row to
   make it pass.
3. `01M1PJWWSSRV3JGADQVYTMRGPB` — pre-commit admission reads the working
   tree. `closes`: verify a reconstructed **index** snapshot (the staged
   content, not the working copy — `git stash --keep-index` is the wrong
   tool because it moves the user's tree; use `git checkout-index` /
   `git archive` of the index into a temp dir, or `git write-tree` + `git
   archive <tree>`), and trigger on `.kb/`, `.kb/extensions/`, `AGENTS.md`,
   the governance docs (`CLAUDE.md`, `docs/kb/**`), `tools/kb/`, the hook
   itself, and `.github/workflows/*.yml`. Keep what the hook does today
   (nixfmt / statix / deadnix on staged Nix, github-sources check, docs
   check, `bun run verify` when kb changed, `intent/gate.sh record`); change
   *what tree it runs against* and *what triggers it*, not what it checks.
   The snapshot must reuse the checked-out `node_modules` (a `bun install`
   per commit is not acceptable) — symlink or `NODE_PATH`; say how. Measure
   the hook's wall time before and after on a kb-touching commit and report
   both; if the snapshot costs more than a few seconds over today, say so
   and stop for the owner's call rather than shipping a slower hook.
   `docs/ci.md` gets the new trigger list; the `#rule` nodes whose `check`
   points at the hook (`hook` surface) keep pointing at `.githooks/pre-commit`
   and `ext.check.audit` must stay clean.

Every gap you close: `status=done` via the CLI, markers off, docs
regenerated.

## Rules

- Gap 1's rewrite is comment-only. `git diff --stat` on those files must show
  line counts equal on both sides except for deletions of unused directives.
- Gap 2's new tests are red before the fix (show the run in the report).
- Gap 3 touches the hook everybody's commits run through. Test it on a
  scratch commit in your worktree before committing it for real, on all
  three shapes: a Nix-only change, a kb-only change, a docs-only change.
- No `.skip`, no new `oxlint-disable`, no baseline edits (a snapshot may only
  be taken when a count drops — gap 1 may drop `knip` or lint counts).

## Commits

1. `chore(kb): suppressions use the oxlint grammar; suppression-grammar unskipped`
2. `feat(kb): the import graph resolves relative and subpath edges and every TS/JS extension`
3. `feat: pre-commit verifies the index snapshot and triggers on every governed surface`
4. `chore(kb): close harness gaps` — statuses, `docs/ci.md`, docs.

Gates before each: `bun run verify`, `bun test packages`, `bun run test:ui`.
Background commits — and for commit 3, the commit itself is the test.

## Ownership answers

Harness src/tests, comment lines anywhere under `tools/kb/packages`, the hook,
`docs/ci.md`: yes. Matrix rows: no. A code change in a package to fix a
bypass gap 2 reveals: one-line import fix yes, anything more file a gap.
Anything else: smallest call, record, continue.

## Report

`docs/kb/waves/2026-09-09/reports/g9.md`: the directive rewrite table (file,
old, new, or deleted-because-unused); the bypass fixtures and their red runs;
whether the real tree had a bypass; the hook's before/after wall time and the
snapshot mechanism; the three scratch-commit shapes and what each triggered;
test output; "Calls I made"; gaps filed.
