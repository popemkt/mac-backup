# r2-rules — rules as nodes, Rule 1 sharpened, doctrine into DESIGN.md

Wave `r2` of `docs/kb/waves/2026-09-03/plan.md` (D5, D6 pointer, D8, D12,
Appendix A.11). Harness: claude. Runs **in parallel with `w1`**; touches no
code under `tools/kb/src|ui|packages`. Files owned: `CLAUDE.md`,
`tools/kb/DESIGN.md` (doc sections only — `w1` may add one paragraph on the
two test runners; expect one trivial merge), `.kb/nodes.jsonl` **only through
`kb` commands**, `docs/kb/*` via `kb action-invoke docs.materialize`, and
whatever the docs extension needs to render a new view
(`tools/kb/extensions-bundled/docs.ts` + `.kb/views/*.json` — the *only* code
file you may touch, and only to add a view; if the extension cannot express
the rules view without a new mechanism, stop and record a gap).

Read first: `plan.md` (all of it), `reports/recon-refrepo.md` §6 (verbatim
rules), §4.3a (property anti-patterns), §3.4 (domain typing), §1.5a/§1.5c
(measured rejections, ratchet semantics), `reports/recon-effect.md` §1.1 + §5
R1, `reports/recon-kb.md` A.10 (gap list) and B.1 (the `order?` /
`onExcessProperty` facts), `CLAUDE.md`, `tools/kb/DESIGN.md`.

## 1. `CLAUDE.md`

- **Rule 1** is the canonical home; do not add a second rule. Append, in
  Rule 1's voice, refrepo's operational parts:
  - *Symptoms* list (new boolean parameter forking a function; second
    slightly-different copy of a path; guard clause exempting one caller;
    wrapper that exists to avoid touching what it wraps; special-casing growing
    at call sites instead of moving into the owning unit).
  - *Reviewer test*: could a reader reconstruct why the code has this shape
    from the current requirement alone, without the edit history?
  - *Bridges over mirrors*; *a dead seam is still a duplicate* (a declared
    abstraction no code path reads is worse than none — kb already says this;
    merge, do not duplicate).
  - *Restructure-then-add as separate commits* when the shape resists.
- **Canonical-statement rule**: every rule has one home; other files link,
  never restate. Restatement is drift.
- **Drift marker**: `// GAP [[<node-id>]]` in code, `#gap` node in kb with
  `expected` / `current` / `impact` / `closes`. An unlabelled workaround is
  drift. Plan D12's two-mechanism rule for soft lint rules (≤ ~30 sites →
  `error` + pinpoint disable with `GAP`; more → ratchet lane), stated once.
- **Effect** subsection: before writing Effect code read
  `tools/kb/node_modules/effect/AGENTS.md` completely (absent until `bun
  install`; the pre-commit hook already guards on that path); v4
  non-negotiables (`Effect.gen` inline, `Effect.fn("name")` /
  `Effect.fnUntraced`, `Schema.TaggedError`, `Context.Service`, `Effect.catch`,
  `Schema` from `"effect"`). Note the skills CLI installs `effect-ts` /
  `effect-v3-to-v4` at repo scope (`w1` does the install; you write the
  sentence).
- Update the `kb — repo knowledge base` section: rules and gaps are nodes;
  `docs/kb/rules.md` is generated; `kb` commands to add a `#gap`.

## 2. kb nodes (the rules index, D5)

Through `kb` only (`kb tag define`, `kb field define`, `kb add`, `kb set`).
Read `tools/kb/DESIGN.md` for how tags template fields and how a field's
allowed values are nodes.

- Tag `#rule` templating fields: `home` (url/text — file + anchor),
  `scope` (text), `principle` (text), `enforcement` (ref → one of the option
  nodes `prose`, `lint`, `tsc`, `harness`, `hook`, `ci`), `gate` (text — the
  script/check name once wired).
- Tag `#gap` templating fields: `expected`, `current`, `impact`, `closes`
  (text), optional `rule` (ref → `#rule`).
- One `#rule` node per rule in plan Appendix A that is a *rule* (not a
  measurement): Rule 1, canonical statement, two-mechanism soft rules,
  boundaries (tag matrix), public surface, version authored once, compiler
  strictness contract, lint scope coverage, warn ratchet, skip pairing, gap
  markers resolve, no conflict markers, isomorphism fence, minimal valid
  entrypoints, spec-first (DESIGN before code), testing doctrine items,
  domain typing items. **`enforcement` is honest at the time you write it**:
  today nearly everything is `prose`; put the planned check name in `gate`.
  `g2`/`d1`/`d2` flip rows as gates land (say so in the report).
- Flip D8: node `01KZG17R7FA9QVYAER8N0E5K8Y` → status `done`; add a child
  `#gap`: expected = one `kb` binary; current = direnv shim `tools/kb/bin/kb`
  wins on PATH inside the repo and `.mcp.json` points at the shim; impact =
  two launch paths; closes = decide shim vs store binary, point `.mcp.json`
  at the winner.
- File the gaps this wave already knows: PROMPT_REVIEW_RULES for the dotfiles
  skills dir; `u1-ui-through-protocol`; SQLite store; CLI-as-client; custom
  merge driver for `nodes.jsonl`; FTS5. Parent them under the Track 2 node
  `01M0Y1J5PHNC0KSAG4ZFKAF9P0` where they belong.
- `docs/kb/rules.md`: a view (like `todos`) rendering `#rule` nodes as a
  table with the enforcement column, and `#gap` nodes below. Materialize;
  `docs.check` must pass in pre-commit.

## 3. `tools/kb/DESIGN.md`

- `### Compiler strictness contract` — the table `g2`'s harness parses:
  `| flag | value | status |` with every flag in plan Appendix A.2 (`on`,
  `rejected` with count, `exception` for `skipLibCheck`). This is *data*; keep
  it a plain markdown table with those three columns exactly.
- Testing doctrine (short, link to refrepo report for the long form):
  property anti-patterns (TAUTOLOGY / STRUCTURAL / quantifier theatre;
  falsifiability runs from the rejecting side; keeper classes); coverage is a
  signal never a gate; mutation advisory never a gate (kb's own weekly
  workflow header already says the score is non-reproducible — cite it);
  L1/L2/L3 (boundaries and branching gate, size warns, cohesion is review).
- Domain typing → Effect `Schema`: no optional-where-discriminated (name
  `KbNode.order?` as the live instance and the `onExcessProperty: "preserve"`
  dependency — Track 2 fixes it, you record it); literal discriminators; one
  canonical schema never re-declared inline; parse `unknown` at every boundary.
- Fix drift: "streaming line parse" → what the code does (read + split) and
  that the target is set by `briefs/p1-persistence.md`; the `oxlint-tsgolint`
  "not verified as a meaningful gate" note → superseded by `g2` (type-aware on,
  measured). Replace the Logseq-storage aspiration under persistence with a
  pointer to the recorded rejection in `briefs/p1-persistence.md` §0.
- One paragraph: two test runners (`bun test` for backend packages + harness,
  `vp test` for `@kb/ui`) and why — `w1` may write the same paragraph; if it
  already exists when you merge, keep one.

## 4. Acceptance

- `intent/gate.sh session claude-code` passed; pre-commit passes (`docs.check`
  green after materialize; kb assets check green).
- `kb query` for `#rule` nodes returns every rule in Appendix A.11 with an
  `enforcement` ref; `docs/kb/rules.md` regenerated and committed.
- `CLAUDE.md` Rule 1 grew by the symptom list + reviewer test only; no second
  rule heading; every other mention of a rule links to its home.
- `DESIGN.md` has the contract table with exactly three columns.
- No file under `tools/kb/src`, `tools/kb/ui`, `tools/kb/packages` touched
  except the docs extension/view if needed.

## 5. Report

`reports/r2-rules.md`: node ids created (tags, fields, option nodes, rules,
gaps), the `kb` commands used, what stayed `prose` and which wave flips it,
DESIGN.md sections touched, anything the docs extension could not express.
