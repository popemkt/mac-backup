# Brief g1-guardrails — make the rules the repo already believes in executable

Harness: opencode. Protocol:
`docs/kb/waves/2026-08-24/briefs/impl-protocol.md`.

## Normative input

`docs/kb/waves/2026-08-23/reports/i11-lint-report.md` — read it whole before
touching anything. It is the specification for this wave and it wins over this
brief wherever they disagree (note the conflict in your handoff).

**Read the SUPERSEDED markers.** §3, §4 and §5 describe an ESLint +
dependency-cruiser stack that the owner rejected on a fewest-tools constraint.
Do not build them. The sections you implement are:

- **§0 / §5b** — oxlint configuration. Oxlint is already `vp`'s lint backend,
  so this adds rules to a linter that already runs, rather than a second
  linter beside it.
- **§6** — knip for dead-code detection, CI/on-demand only.
- **§7** — the mandatory `**/*.css` override.
- **§8** — the `verify` script.
- **§9** — the seven ordered implementation steps. Follow that order.
- **§10** — acceptance criteria. These are your acceptance criteria.

## The point of the wave

This repo keeps writing down architectural intent — module boundaries in
`AGENTS.md`, the Rule 1 abstraction constraint, the "no parallel path" rule —
and then relies on reviewers to enforce it. i11 found the predictable result:
boundaries stated in prose get crossed, cycles form, `any` leaks in at the
seams, and nobody notices until a wave goes wrong. Your job is to convert the
prose the repo already believes into rules a machine fails on.

That framing has a consequence for how you work: **a rule that has never gone
red is not known to work.** For every rule you enable, deliberately write the
violation it is supposed to catch, watch it fail, then delete the violation.
Put that evidence in your handoff. A config full of rules that match nothing is
exactly the "declared abstraction no code path reads" that Rule 1 forbids.

## §11 — answer the open questions this way

The report leaves four questions open. The owner's answer is: **take the
report's own recommendation in each case.** Specifically:

- The three known `any` leak sites — `ui/src/api/ws.ts`,
  `ui/src/components/graph/force3d-three.ts`,
  `ui/src/components/canvas/canvas-page.tsx` — are **fix now**, in this wave,
  not suppressed and not deferred. `typescript/no-explicit-any` lands at
  `warn` as the report recommends, but those three files end this wave with no
  `any` at all, so the warning count is a ratchet from a clean floor rather
  than a number nobody reads.
- Where the report offers a strict and a lenient reading, take strict for new
  code and lenient only where it would force a same-wave refactor outside your
  zone — and name each such concession in the handoff.

If any of the four questions turns out to have no recommendation in the report,
decide it, implement it, and justify the decision in one paragraph. Do not
leave a question open and a rule unwritten.

## Zone

Yours:
- `tools/kb/.oxlintrc.json` (new), and the `vp` lint block in
  `tools/kb/vite.config.ts` if wiring requires it
- `tools/kb/knip.json` (new)
- `tools/kb/package.json` — scripts and the pinned knip devDependency.
  **You own this file for the wave**; keep your edits contiguous.
- `tools/kb/ui/tsconfig.json` / `tools/kb/ui/vite.config.ts` only if alias
  resolution for knip demands it (`@/*`, `@kb/*`)
- The three `any` leak files named above
- Whatever minimum edits elsewhere are needed to bring the tree to zero
  errors under the new rules — this is expected and is not scope creep, but
  keep each such edit the smallest change that satisfies the rule, and list
  them in the handoff
- `docs/` — including an `AGENTS.md` note if a boundary rule now has teeth

Not yours: `tools/kb/tests/**` beyond what a rule forces, `ui/src/catalog/**`
(s1 owns it), `src/foundation/model.ts` time/id seams (t2 owns them).

## Acceptance

§10 of the report, plus:

- `npm run verify` exists and is the single entry point a human or CI runs.
- Boundary rules are real: `no-restricted-imports` actually forbids the
  crossings `AGENTS.md` describes (surface ↔ foundation direction, UI not
  reaching into backend internals), demonstrated red-then-green.
- `import/no-cycle` is on and the tree is cycle-free.
- `react/exhaustive-deps` is on. If it lights up existing code, fix it or
  justify each suppression inline with a comment saying why the dep is
  deliberately omitted — never a bare disable.
- `typescript/ban-ts-comment` is on and the three leak files are `any`-free.
- knip runs green, is **not** in `.githooks/pre-commit`, and its entrypoints
  are exactly `index.ts`, `src/surface/{cli,ui,mcp}.ts`, `ui/src/main.tsx`,
  plus test globs.
- The `**/*.css` override from §7 is present. (Context: the previous wave hit
  a real bug where a CSS file's contents were validated by a rule that did not
  understand CSS; §7 is not hypothetical.)
- Four-command verification green, counts reported.
