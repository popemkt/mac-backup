# c1-check-plugin — `#check` as a bundled extension: rules point at what checks them, and the plugin proves it

Wave `c1` of `docs/kb/waves/2026-09-07/plan.md` (Decisions 1–3). Harness:
codex. Branch from `main` @ `bd2303b`. You own: a **new**
`tools/kb/packages/extension/ext-check/**` (`scope:backend`, layer
`extension`), the one `BUNDLED_EXTENSIONS` line in
`tools/kb/packages/app/runtime/src/registry.ts`, a **new**
`tools/kb/packages/app/cli/src/bin/check-audit.ts`, one script line
`check:audit` in `tools/kb/package.json` and its place in the `verify` chain,
one paragraph in `tools/kb/AGENTS.md` (extension section), the `#check` nodes
you mint through the CLI, the `check` refs and re-derived `enforcement` on
existing `#rule` nodes, the regenerated `docs/kb/rules.md`, and your report.
You do **not** touch `@kb/ext-docs` or its `rules` template.

Read first: `tools/kb/packages/extension/ext-docs/src/{index,rules}.ts` (the
reference extension: Effect-native actions, `TemplateContext`, `propText`),
`tools/kb/packages/app/cli/src/bin/docs-check.ts` (the bin pattern: parse the
declared output, exit 1 on not-clean), `registry.ts` :65-68
(`BUNDLED_EXTENSIONS`), `contracts/src/extension.ts`, the `#rule` tag and its
five fields in `.kb/nodes.jsonl` (tag `01M1M029AZPYCXJ8ZSSZ41A965`; fields
`home` `01M1M01N7QN8DJAN6F2CKRM9A1`, `scope` `01M1M01NMVCPYTCCJYVZSNB1N4`,
`principle` `01M1M01P17Y5E09Q6C9Y14NETP`, `enforcement`
`01M1M01PMXYSBVR4WARCA9GH12` — a ref into tag `enforcement-level`
`01M1M028WWE79KKKEC9Z4P48ZK` whose values are `prose|lint|tsc|harness|hook|ci`
— `gate` `01M1M01PZZCB1EPR6188PGVHYB`), the gap this wave closes
`01M1PJXPBSJ6J25ZCEAX0G0AN7`, `docs/kb/rules.md` as it stands, and §8 of
`docs/kb/waves/2026-09-04/reports/kb-comprehensive-architecture-governance-review.md`.
Run `intent/gate.sh session codex` first.

## Why

Fourteen rules in `docs/kb/rules.md` say `enforcement: prose` while their
`gate` names a harness test that exists and runs in `bun run verify`. The
index lies in the safe direction, but it lies: it cannot answer "what is
actually checked, where, and what is still prose". The fix is not a better
hand-typed value; it is a node that names the check and a plugin that proves
the check is wired where the rule claims.

## Shape

Nodes (mint with `bun tools/kb/packages/app/cli/src/main.ts tag define …` /
`field define …` / `field type …` / `field target …`; never edit the JSONL):

- tag `check-surface`, values (nodes tagged with it): `harness`, `lint`,
  `tsc`, `hook`, `ci`. Reuse the existing `enforcement-level` value nodes if
  you can make one tag serve both — one set of five nodes, not two. Say which
  you did and why.
- tag `check` with fields: `surface` (ref → `check-surface`), `evidence`
  (text: repo-relative path of the implementation, e.g.
  `tools/kb/harness/tests/skip-pairing.test.ts`), `invocation` (text: the
  literal the surface's files must contain, e.g. `bun run harness`,
  `docs-check.ts`, `no-explicit-any`), `blocking` (checkbox).
- field `check` on tag `rule` (ref → `check`). `rule.enforcement` stays.

Package `@kb/ext-check` (`packages/extension/ext-check`, deps like ext-docs:
`@kb/contracts`, `@kb/model`, `@kb/operations`, `effect`, `zod`; it needs the
`FileSystem` service for the surface files — ask for it in R exactly as
`ext-docs` does, never import `node:fs`):

- `ext.check.audit` (`mode: "read"`), output
  `{ clean: boolean, findings: Finding[] }` where `Finding` is a zod
  discriminated union on `kind`, one variant per failure below, each carrying
  `rule` and/or `check` node ids and a one-line `message`. Findings, in order:
  1. `check-missing`: `rule.check` names a node that is not tagged `check`
     (the ref constraint should make this impossible; audit it anyway).
  2. `evidence-missing`: `check.evidence` is not a file under the repo root.
  3. `invocation-unwired`: `check.invocation` does not appear in the files of
     `check.surface` — **one table** `SURFACE_FILES: Record<surface, glob[]>`
     drives all five surfaces (Decision 3). Repo root is `ctx.root`.
  4. `enforcement-stale`: `rule.enforcement` ≠ (`rule.check ? check.surface : "prose"`).
  5. `gate-and-check`: a rule carries both `gate` and `check`.
  6. `home-broken`: `rule.home` is `path[#anchor]`; the path must exist and,
     when an anchor is given, a heading in that markdown must slug to it
     (GitHub slug rules: lowercase, spaces→`-`, drop punctuation except `-`).
- `ext.check.sync` (`mode: "apply"`), output `{ updated: NodeId[] }`: for
  every `#rule`, set `enforcement` to the derived value (unset the old ref
  first — props are multi-valued). Go through `@kb/operations`' persist path so
  the tx log and index see it; do not write the store directly.
- Tests (`bun test`, under `tests/`): one red case per finding kind over an
  in-memory fixture (`@kb/test-kit` has the DST runtime; use it), plus
  `sync` then `audit` is clean, and audit is pure (no writes).

Bin and chain:

- `packages/app/cli/src/bin/check-audit.ts` mirrors `docs-check.ts`: open,
  invoke `ext.check.audit`, parse the declared output, print one line per
  finding as `kind — message (rule <id>)`, exit 1 when not clean.
- `tools/kb/package.json`: `"check:audit": "bun packages/app/cli/src/bin/check-audit.ts"`,
  appended to `verify`. `.githooks/pre-commit` already runs `verify` when
  `tools/kb/` changes; do not add a second hook line. If `scripts-chain-exists`
  or `public-surface` in the harness object, satisfy them the way the docs bin
  does.

Data:

- Mint one `#check` per harness test that a rule's `gate` already names
  (`skip-pairing`, `gap-markers-resolve`, `lint-warn-ratchet`, `public-surface`,
  `version-authored-once`, `lint-scope-coverage`, `no-conflict-markers`,
  `scripts-chain-exists`, `tsconfig-contract`, `boundaries` ×2 — module
  boundaries and isomorphism fence), one each for the two hook rules
  (`docs-check.ts`, `intent/gate.sh record git-commit`), and for the two lint
  gates that are real (`no-explicit-any`, `complexity`). A rule whose `gate`
  names a check that does not exist keeps `gate` and gets no `check`.
- Set `check` on those rules, **unset** their `gate` (Decision 2), run
  `ext.check.sync`, run `docs.materialize`, run `check:audit` — clean.
- Close gap `01M1PJXPBSJ6J25ZCEAX0G0AN7` (`status=done` the way the three
  done gaps do it). Add a `#rule` node for Decision 2 (`home` =
  `tools/kb/AGENTS.md#extensions`, its own `check` = the audit itself).

Docs:

- `tools/kb/AGENTS.md`, extension section: one paragraph — what `@kb/ext-check`
  does and the **removal recipe**: delete `packages/extension/ext-check`,
  the `BUNDLED_EXTENSIONS` line, `bin/check-audit.ts`, the `check:audit`
  script and its `verify` mention; the `check`/`check-surface` nodes and
  `rule.check` refs are data and may stay or be `rm`'d. After removal the
  rules index is the hand-typed one.
- `tools/kb/DESIGN.md` gets nothing unless a core seam changed; it should not.

## Commits

1. `feat(kb): @kb/ext-check — #check nodes, audit, sync` (package + tests +
   registry line; nodes minted).
2. `feat(kb): check:audit in the verify chain` (bin + script + AGENTS.md).
3. `chore(kb): link rules to their checks; derive enforcement` (data + regenerated docs + gap closed).

## Report

`docs/kb/waves/2026-09-07/reports/c1.md`: the finding kinds and their red
cases, the before/after enforcement histogram (`prose` count went from 24 to
N), which rules still have no check and why, whether one tag serves both
surface and enforcement-level, the removal recipe verified by actually
performing it on a scratch branch and running `verify` (say so), verify /
test output, and anything you had to leave as a gap.
