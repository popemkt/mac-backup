# r2-rules — report

Wave `r2` of `docs/kb/waves/2026-09-03/plan.md` (D5, D6 pointer, D8, D12,
Appendix A.11). Brief: `briefs/r2-rules.md`. Harness: claude-code, admission
recorded (`intent/gate.sh session claude-code`, exit 0).

Branch `worktree-agent-a82ac792607c64b1a` in the worktree
`/Users/popemkt/.dotfiles/.claude/worktrees/agent-a82ac792607c64b1a`. Nothing
pushed, nothing merged, no `rtk rebuild`.

## Commits

| commit | what |
|---|---|
| `54dfdec` | `docs:` Rule 1 sharpened; canonical-statement and drift-marker rules; Effect pointer |
| `db2f8c0` | `chore(kb):` `#rule` / `#gap` tags, fields, option nodes, 26 rules, 9 gaps, `rules` view, `docs/kb/rules.md` |
| `fdec9d6` | `docs(kb):` DESIGN.md contract table, testing doctrine, domain typing, drift fixes |
| (this file) | `docs:` wave report |

Pre-commit ran on every commit: `docs.check` green, kb assets check green,
`tsc --noEmit` green for `tools/kb` (`tools/kb/ui` deps absent in this
worktree — the hook's own warn-and-skip path). Backend suite green:
`bun test tests/` → 313 pass / 0 fail (including `tests/benchmark.test.ts`,
which the plan lists as known-red at base — it passes on this machine).
`oxlint` over `index.ts src ui/src extensions-bundled`: zero errors, warning
set unchanged from base.

## 1. `CLAUDE.md` (symlink → `AGENTS.md`)

Rule 1 grew, and grew only by the operational half of refrepo's ground-up
implementation rule:

- the **symptom list** (boolean parameter forking a function; a second
  slightly-different copy of a path; a guard clause exempting one caller; a
  wrapper that exists to avoid touching what it wraps; special-casing growing
  at call sites);
- the **reviewer test** (reconstruct the shape from the current requirement
  alone, without the edit history);
- **restructure-then-add as separate commits**, with the redesign radius named;
- **bridges over mirrors** as a new bullet, and **"a dead seam is still a
  duplicate"** *merged into* the existing dead-abstraction bullet rather than
  restated beside it (the brief's explicit instruction, and the first
  application of the canonical-statement rule).

Two new sections, both rules that have no other home in this repo:

- `## Canonical statements` — one home per rule; other files link, never
  restate; the rules index is kb data; `enforcement` is honest and `prose`
  means nothing checks it.
- `## Drift markers and gaps` — `// GAP [[<node-id>]]` + a `#gap` node with
  `expected` / `current` / `impact` / `closes` / `rule`; skip pairing; plan
  D12's two-mechanism rule for soft lint rules, stated once; the `kb add`
  line for filing a gap.

The `kb — repo knowledge base` section gained a `### Effect` subsection (read
`tools/kb/node_modules/effect/AGENTS.md` completely first; the v4
non-negotiables; the fresh-clone caveat and the pre-commit precedent; the
skills-CLI sentence — `w1` does the install) and one bullet saying rules and
gaps are nodes rendered to `docs/kb/rules.md`.

No second heading restates Rule 1.

## 2. kb nodes

All writes went through `kb` commands only. The commands used, in order:

```bash
kb field define <name>                       # ×10
kb field type <name> text|ref                # ×10
kb tag define enforcement-level
kb tag define rule --field home --field scope --field principle \
                   --field enforcement --field gate
kb tag define gap  --field expected --field current --field impact \
                   --field closes --field rule
kb field target enforcement enforcement-level
kb field target rule rule
kb add "<option>" --tag enforcement-level    # ×6
kb add "<rule>"  --parent <index> --tag rule --prop home=… --prop scope=… \
                 --prop principle=… --prop enforcement:ref=… --prop gate=…
kb add "GAP: …"  --parent <parent> --tag gap --prop expected=… --prop current=… \
                 --prop impact=… --prop closes=… [--prop rule:ref=…]
kb unset 01KZG17R7FA9QVYAER8N0E5K8Y status todo
kb set   01KZG17R7FA9QVYAER8N0E5K8Y status done
kb action-invoke '{"id":"docs.materialize","input":{}}'
```

### Tags

| tag | id |
|---|---|
| `#rule` | `01M1M029AZPYCXJ8ZSSZ41A965` |
| `#gap` | `01M1M029QRJ6KP5NYK28WAEH20` |
| `#enforcement-level` | `01M1M028WWE79KKKEC9Z4P48ZK` |

`enforcement-level` exists because a field's allowed values are nodes: the
`enforcement` field is a ref constrained by `sys.f.targetTag` to that tag's
instances, the same shape `sys.f.fieldType` uses for `sys.tag.field-type`. Its
text differs from the field's (`enforcement-level` vs `enforcement`) for the
same reason `field-type` differs from `fieldType` — readability, not
necessity; name resolution is kind-scoped, so a tag and a field may share text.

### Fields

| field | id | type |
|---|---|---|
| `home` | `01M1M01N7QN8DJAN6F2CKRM9A1` | text |
| `scope` | `01M1M01NMVCPYTCCJYVZSNB1N4` | text |
| `principle` | `01M1M01P17Y5E09Q6C9Y14NETP` | text |
| `enforcement` | `01M1M01PMXYSBVR4WARCA9GH12` | ref → `#enforcement-level` |
| `gate` | `01M1M01PZZCB1EPR6188PGVHYB` | text |
| `expected` | `01M1M01QDFMQYJQCPAD8NG4C0Z` | text |
| `current` | `01M1M01QTWDC6JP1T1QN2SFRN5` | text |
| `impact` | `01M1M01RB2P8V85GCS46SW7MYJ` | text |
| `closes` | `01M1M01RWT1ABKJHT5DRKW1Q2T` | text |
| `rule` | `01M1M01SAAA17AM22SX9HZCCG1` | ref → `#rule` |

`home` is `text`, not `url`: its values are repo paths plus anchors, not URLs.

### Enforcement option nodes

| option | id |
|---|---|
| `prose` | `01M1M02F3T1P5JHMJ17Q0363XP` |
| `lint` | `01M1M02FAXCWC0SY5NDDXE4VSB` |
| `tsc` | `01M1M02FHZ8QF5QJ8R535G37KY` |
| `harness` | `01M1M02FRDR686VP0WN17KTDX2` |
| `hook` | `01M1M02FYYCPM96Q09G3SM2EBS` |
| `ci` | `01M1M02G5M43DP8QW7HK9JB0VS` |

### Rules — 26 nodes, parented under `01M1M070FXB8WY5DM7AE22RVGZ` ("Rules index")

Every one carries an `enforcement` ref (verified by datalog: 26 rules, 26 with
an enforcement ref).

| rule | id | enforcement today | flipped by |
|---|---|---|---|
| Admission gate | `01M1M077SN1F7JEG6JNJEHEHBD` | **hook** | — already enforced |
| Generated docs are data | `01M1M077HD146G108CE2MD9T7S` | **hook** | — already enforced |
| Module boundaries | `01M1M0727Z39Z9BMBPBDVHT4Z7` | **lint** | `w1` widens it to the nx-graph tag matrix (`harness boundaries`) |
| Abstraction before addition (Rule 1) | `01M1M070VYEA0JNAHV2P3RBGMS` | prose | nothing — judgement, no mechanical gate exists |
| Canonical statements | `01M1M0714S55JFNBD1YYPEDM7T` | prose | nothing planned; a "rule heading not in the index" check is the obvious candidate and is not designed |
| Code-unit cohesion (L1/L2/L3) | `01M1M075TQTACMSRKKPE1Z18E9` | prose | `g2` (oxlint `complexity` / `max-depth`) + `w1` (`harness boundaries`) |
| Compiler strictness contract | `01M1M07315T8RY4ZQB5ACGDAS3` | prose | `g2` (`harness tsconfig-contract`) |
| Coverage is a signal | `01M1M075AG7H0ZCA72W0KMVDAQ` | prose | nothing — the rule is that there is no gate |
| Domain typing — discriminator over optional | `01M1M0764DHVB094RK4JG68N4E` | prose | nothing mechanical; `p1` closes the live violation |
| Domain typing — literal discriminators | `01M1M076G6MKPQ9FMTPYMVQ9W5` | prose | `g2` partially (`switch-exhaustiveness-check`) |
| Domain typing — one canonical schema | `01M1M076RKFMR3PQ3ENC5DHCZT` | prose | nothing — review only |
| Domain typing — parse unknown at the boundary | `01M1M0770G8RWH267NE6N0SE2G` | prose | `g2` (`no-explicit-any`, `consistent-type-assertions`, `no-unsafe-type-assertion` lane) |
| Drift markers | `01M1M071DD75C6RZAFDPGTH46Z` | prose | `g2` (`harness gap-markers-resolve`) |
| Effect v4 idiom | `01M1M0778JD9Q8CF1CDAZGPS6B` | prose | `g2` (`@effect/tsgo` correctness diagnostics through `tsc`) |
| Isomorphism fence | `01M1M0746TG16GH0KDBN5YQVCH` | prose | `g2` (oxlint `no-restricted-imports` override on shared packages) |
| Lint scope coverage | `01M1M0739V3QNX0BH5FQZR9ER5` | prose | `g2` (`harness lint-scope-coverage`) |
| Minimal valid entrypoints | `01M1M074G2CZ69F5R13WEJJ2ZG` | prose | `g2` (`harness scripts-chain-exists`) |
| Mutation score is advisory | `01M1M075JX29180QM4NHHCY7YA` | prose | nothing — the rule is that there is no gate |
| No conflict markers | `01M1M073WXXC4FFEA6T1S3M3EM` | prose | `g2` (`harness no-conflict-markers`) |
| Property selection | `01M1M07505986FYT51XSJVDQZS` | prose | nothing — human-owned by design |
| Public surface | `01M1M072GHQNR26301E34TDHH0` | prose | `w1` (`harness public-surface`) |
| Skip pairing | `01M1M071XDJNFPE9QZKJCEX61Y` | prose | `g2` (`harness skip-pairing`) |
| Spec-first changes | `01M1M074R5WXWJD1QX4HEY7317` | prose | nothing — ordering discipline, no gate |
| Two-mechanism soft rules | `01M1M071NJXGH06GP3XWHABR76` | prose | `g2` (`harness lint-warn-ratchet` + `gap-markers-resolve`) |
| Version authored once | `01M1M072SE0MEKSF7A9JCAKESS` | prose | `w1` (`harness version-authored-once`) |
| Warn ratchet | `01M1M073JY9F2PBFWRZHFTF5FC` | prose | `g2` (`harness lint-warn-ratchet`) |

So: **3 enforced, 23 `prose`.** Of the 23, `g2` flips 11 and `w1` flips 2; the
remaining 10 are judgement rules with no mechanical gate, and the table says so
rather than implying a check exists. `d1` / `d2` flip no `enforcement` cell —
they move counts inside lanes `g2` creates.

### Gaps — 9 nodes

| gap | id | parent |
|---|---|---|
| two launch paths for the kb binary | `01M1M08VKDXG6AFZHQPW5M2GRF` | `01KZG17R7FA9QVYAER8N0E5K8Y` (the D8 todo) |
| rules view needs a template the docs extension cannot own | `01M1M08VXGJ5RTQJ3AJNK12G79` | Rules index |
| agent-prompt review rules are not ported | `01M1M08W6Z70XV3KCQB5CWH3ZR` | Rules index |
| no SQLite index behind the store port | `01M1M08WEYJNEFDZVECN9QKEWT` | `01M0Y1J5PHNC0KSAG4ZFKAF9P0` (Track 2) |
| CLI pays full cold start on every invocation | `01M1M08WPQTB514E7JERKYEDWZ` | Track 2 |
| `nodes.jsonl` has no merge driver | `01M1M08WYY9X6HFNN5GKDCC47E` | Track 2 |
| search is a substring scan, no text index (FTS5) | `01M1M08X7037FH9Z0Y5G1RFRXX` | Track 2 |
| the browser holds the whole graph (`u1-ui-through-protocol`) | `01M1M08XEH901FXF4MRKJKCSQA` | Track 2 |
| `KbNode.order` is optional and undeclared | `01M1M08XNE3SBGY1MMNA1A73VX` | Track 2 |

Two carry a `rule` ref: the binary gap and the template gap point at Rule 1;
the `KbNode.order` gap points at *discriminator over optional*. The
`KbNode.order` gap is the extra one — the brief asks DESIGN.md to record it,
and it is a live violation of a rule this wave just wrote down, so it is also a
node.

### D8

`01KZG17R7FA9QVYAER8N0E5K8Y` → `status=done` (unset `todo`, set `done` — props
are multi-valued and `set` appends). `docs/kb/todos.md` moved the row from
*todo* to *done* on the next materialize.

## 3. `tools/kb/DESIGN.md`

Sections touched:

- **Decisions table** — fixed the broken `#runtime-tooling-boundary` anchor
  (the heading slugifies to `#runtimetooling-boundary`).
- **Runtime/tooling boundary** — the `check` bullet's "oxlint-tsgolint is not
  verified as a meaningful gate" note is now marked superseded by `g2`, with
  the reason (an Effect tree with `Effect.runFork` in `setTimeout` and WS
  callbacks is what `no-floating-promises` exists for). The two statements
  about test runners collapsed into **one** paragraph — `bun test` for the
  backend packages and the harness, `vp test` for `@kb/ui`, and why neither is
  a fallback for the other. (`w1` may write the same paragraph; keep one.)
  Added the *minimal valid entrypoints* bullet, which is that rule's home.
- **`### Compiler strictness contract`** (new) — the plain three-column
  `| flag | value | status |` table with every flag from plan Appendix A.2:
  15 `on`, `skipLibCheck` as `exception`, `noPropertyAccessFromIndexSignature`
  as `rejected (114 backend + 239 ui)`. Prose below the table (not in it)
  explains the two non-`on` rows, states that `module` / `target` /
  `moduleResolution` / `paths` are deliberately absent from the base, and
  places the `@effect/tsgo` plugin — which is not a top-level `compilerOption`
  and would break a harness that parses the table as one.
- **`## Spec-first changes`** (new) — spec edits precede code edits; if the
  section cannot be written the code cannot be written; drift is written down
  first. Home for the *Spec-first changes* rule.
- **`## Testing doctrine`** (new) — property anti-patterns (TAUTOLOGY /
  STRUCTURAL / quantifier theatre) as a table reviewers cite by name,
  falsifiability from the rejecting side, keeper classes, mandatory
  determinism; coverage is a signal never a gate; mutation score advisory,
  citing kb's own weekly workflow header calling the score non-reproducible;
  L1/L2/L3 with size warning and boundaries/branching gating.
- **`## Domain typing — Effect `Schema`** (new) — no optional-where-
  discriminated, naming `KbNode.order?` and the `onExcessProperty: "preserve"`
  dependency as the live instance; literal discriminators (with the model's
  five actual discriminators named); one canonical schema never re-declared
  inline; parse `unknown` at every boundary.
- **Storage** — "streaming line parse (no read-whole-string-then-split)"
  replaced by what the code does (read whole file, split, decode per line) plus
  the statement that the streaming parse is a target owned by
  `briefs/p1-persistence.md`; the open-ended "future backends (SQLite cache,
  dolt, md-outline)" replaced by a pointer to the recorded rejections in
  `briefs/p1-persistence.md` §0 (Logseq's fork included) and the one survivor,
  a derived `bun:sqlite` index that the type must declare as a cache.

## 4. What the docs extension could not express

**The rules view needed a template, and there is no seam for one.** Templates
are named TS functions in a plain `Record<string, TemplateFn>` exported from
`src/operations/docs/templates.ts`; `renderViewEffect` looks the view's
`template` up in that record. There is no registration API, and `src/**` is
`w1`'s file territory this wave.

DESIGN.md says core ships mechanism and extensions ship policy — "what markdown
to write where, repo-specific output of any kind". A rules table for *this*
repo is policy by that definition, so it belongs to the extension; but the only
way to get it there today is for `extensions-bundled/docs.ts` to write into
core's record at module load:

```ts
// GAP [[01M1M08VXGJ5RTQJ3AJNK12G79]] — core exposes no template-registration
// seam, so this extension writes its template into core's table at load.
templates["rules"] = rules;
```

That works (the extension module is imported by the registry before any render)
and it keeps the template with the view that needs it, but it gives template
ownership two homes and is unavailable to third-party `.kb/extensions`, which
cannot import core internals at all. It is a workaround, so it is labelled and
filed as `01M1M08VXGJ5RTQJ3AJNK12G79` — the first use of the drift-marker rule
this wave wrote. **The clean version is a real template-registration seam in
the render backbone** (an extension contributes templates alongside actions);
whoever owns `src/operations/docs/` next should take it, and this wave did not
because the brief fences `src/**`.

Everything else the view needed, the extension already had: the `#gap` section
is derived from `ctx.nodes` the same way the `todos` template discovers project
tags, so one view renders the whole index.

## 5. Shared-file touches (merge notes for `w1`)

- `tools/kb/DESIGN.md` — doc sections only. If `w1` wrote its own two-test-
  runners paragraph, keep one (mine is under *Runtime/tooling boundary*).
- `tools/kb/extensions-bundled/docs.ts` — new imports (`KbNode`/`NodeId` from
  `src/foundation/model.ts`, plus `renderText`, `templates`, `TemplateContext`
  from `src/operations/docs/index.ts`) and the `rules` template. If `w1` moves
  `src/operations/docs/` into a package, these import paths move with it and
  the `templates[…]` assignment moves with them.
- `.kb/nodes.jsonl` — owner data, `kb`-only writes, as required.
- No file under `tools/kb/src`, `tools/kb/ui` or `tools/kb/packages` was
  touched.
