# r1-review-cleanup — act on the verified findings of the codex governance review

Wave `r1` of `docs/kb/waves/2026-09-05/plan.md`. Harness: codex. Branch from
`main`. Runs beside `p1a`/`p1b`/`p1c`; ownership below is disjoint from theirs
and is the whole of what you may edit.

Source: `docs/kb/waves/2026-09-04/reports/kb-comprehensive-architecture-governance-review.md`
(untracked in the coordinator checkout; you get it copied into your worktree
at the same path — commit it as part of commit 1 so the record is durable).
The coordinator verified it against `main` on 2026-09-04; every item below
reproduced. Do not re-audit; act.

Read first: `AGENTS.md` (Rule 1, Canonical statements, Drift markers), the
review §6, §13.5, §13.7, §13.10; `tools/kb/harness/README.md` if present, else
`harness/src/snapshot.ts` and `harness/tests/lint-warn-ratchet.test.ts`.
Run `intent/gate.sh session codex` first.

## You own

- `tools/kb/harness/**` (source, tests, `lint-warn-baseline.json` via
  `bun run harness:snapshot` only)
- `tools/kb/package.json` scripts and `tools/kb/knip.json` (or wherever knip is
  configured); `tools/kb/.oxlintrc.json`
- `tools/kb/packages/app/server/src/build.ts` (one comment)
- `tools/kb/packages/app/ui/ARCHITECTURE.md`; the three UI files carrying
  unused disable directives: `ui/src/lib/view-config.ts`,
  `ui/src/components/ontology/ontology-page.tsx`,
  `ui/src/components/canvas/canvas-page.tsx` (directive lines only)
- `tools/kb/packages/extension/ext-docs/**` (the `rules` view template)
- `tools/kb/DESIGN.md` §Runtime/tooling boundary and §Persistence wording
  about `nodes.jsonl.lock` (p1a owns §Performance — do not touch it)
- `docs/ci.md`
- `.kb/nodes.jsonl` **through the kb CLI only**
  (`bun tools/kb/packages/app/cli/src/main.ts …`), then `docs.materialize`
- your report `docs/kb/waves/2026-09-05/reports/r1-review-cleanup.md`

**Not yours** (other live workers): `packages/domain/**`, `contract/**`,
`infrastructure/**`, `application/**`, `app/runtime/**`, `app/server/src/{session,http}.ts`,
`app/cli/**`, `app/mcp/**`, `app/test-kit/**`, `ui/src/ds/**`, `.gitignore`.
The registry output-schema P0 lives in `app/runtime` → p1b's tree; it is
recorded as a gap in commit 3 and fixed in the next wave, not by you.

## Commit 1 — `docs(kb): correct stale paths and deleted-machinery commentary`

- `build.ts:7` and `ARCHITECTURE.md:3`: `tools/kb/ui` → `tools/kb/packages/app/ui`.
- `harness/src/constraints.ts` header: no Nx project graph, no `layer:*` tags;
  say "import-derived package graph" and that `@kb/test-kit` sits under `app/`
  because it is a composition root. One sentence beside the layer list
  distinguishing `application/` (use-cases, infrastructure-free) from `app/`
  (composition roots and delivery surfaces).
- `ARCHITECTURE.md`: Storybook is installed (`@storybook/react` in the UI
  manifest). Either the "Reject" row is wrong or the dependency is; find which
  by `git log -S storybook`, state the live decision once, delete the other.
- `DESIGN.md:514` says the lock file is not gitignored; `.gitignore:38` ignores
  it. Fix the prose.
- `docs/ci.md`: describe what `.github/workflows/validate.yml` runs today
  (`bun run verify`, `bun run test`, `bun run test:ui`, `bun run test:dst`);
  delete the npm-era text and the separate-UI-typecheck paragraph.
- kb nodes: the todo naming `packages/runtime/tests` → `packages/app/runtime/tests`;
  the `Module boundaries` rule → `home` = `tools/kb/harness/src/constraints.ts`,
  `enforcement` = `harness`, `gate` = `bun run harness (boundaries.test.ts)`,
  principle text without the `(w1)` history. Materialize.
- Commit the review report file.

## Commit 2 — `feat(kb-harness): ratchets fail on any mismatch; collectors report health; suppressions are one form`

- `lint-warn-ratchet.test.ts`: a count below baseline **fails** with the
  message "run bun run harness:snapshot" — monotonic means the baseline always
  equals reality. Red test: baseline 3, actual 1 → fail.
- `snapshot.ts` collectors: return `{ ok, findings }`; a tool that failed to
  execute or whose JSON did not decode makes the harness fail, never an empty
  count. Red test with a stubbed non-JSON output.
- Unused disable directives fail: `oxlint --report-unused-disable-directives`
  in the root `lint` script (or the config key, if oxlint has one — check
  `oxlint --help`), and remove the four unused sites the review lists.
- One suppression grammar, checked by a harness test over every `.ts/.tsx`:
  `// oxlint-disable-next-line <rule> -- GAP [[id]]` or
  `// oxlint-disable-next-line <rule> -- <reason>`; the `eslint-` prefix is
  not accepted. Count the sites first: if `eslint-` sites are all in files you
  own, rewrite them; otherwise the test lands **skipped with a GAP marker** and
  the gap node names the files, so p1b/p1c rewrite theirs and the next wave
  un-skips. Do not edit files you do not own to make it pass.
- Knip: `--no-exit-code` goes. Configure knip to zero if it can be done
  honestly (entry points, `ignoreDependencies` with a reason each) — else feed
  its finding identities into the same baseline file as the lint ratchet
  (`lanes.knip`), rise fails, zero promotes. One ratchet mechanism, not two.
  Report which you chose and why.

## Commit 3 — `docs(kb): gap ledger carries the review's open findings`

For each of these, one `#gap` node via the CLI with `expected`, `current`,
`impact`, `closes`, and `rule` (the `#rule` id it bends; look them up with
`kb search`): registry output schema unparsed (rule: parse unknown at the
boundary); `importEdges` matches bare `@kb/x` only (rule: Module boundaries);
`.kb/extensions` has no admission step; `Store` + `EffectStore` both on
`KbContext`; `CORE_ACTIONS` hand-paired; ext-sdk mirror not
bidirectionally typed; UI cross-surface imports (list the 7 real ones — Bullet
and NodeRow are sanctioned primitives, exclude them); pre-commit checks the
working tree not the staged snapshot; no branch protection on `main`; rule
`enforcement` is hand-typed, not derived from a `#check`. Then the `rules`
view template (`ext-docs`) renders gaps with `status=done` under a separate
"Closed" heading. Materialize.

## Acceptance

`bun run verify`, `bun test packages`, `bun run test:ui` green; `bun run
harness` shows the new red cases passing; `git grep -n "tools/kb/ui\b" tools/kb`
hits only `http.ts:122` (p1b's) and historical wave docs; `docs.check` clean.

## Report

`docs/kb/waves/2026-09-05/reports/r1-review-cleanup.md`: each review finding
→ fixed / gap id / left to p1b, the knip decision, the suppression-grammar
count, anything you found that the review missed.
