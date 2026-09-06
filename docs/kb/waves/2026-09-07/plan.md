# Wave 2026-09-07 — a second store, checks as a plugin, the UI fenced and split

Owner (2026-09-05): "please make check a plugin, make it so it's easily
removable. the other 2 [SqliteStore, UI hotspot refactor], i trust you to
figure it out gradually." Division stays opus : cursor : codex = 2 : 1 : 2.

Base: `main` @ `bd2303b` (wave 2026-09-06 closed). The ports this wave builds
on — `EffectStore` (with `fingerprint`), `KbIndex` (`run(ir)`, `applyTx`),
`KbTxLog`, the extension contract, the one composition root in
`app/runtime/src/layers.ts` — all exist and are exercised.

## Decisions

| # | Decision |
|---|---|
| 1 | **`#check` is a bundled extension, `@kb/ext-check`, and nothing in core knows it exists.** Its tags and fields are nodes; its two actions are `ext.check.audit` (read: rules ↔ checks ↔ the files that run them) and `ext.check.sync` (apply: write each rule's `enforcement` from its check's surface). The `rules` template keeps reading the stored `enforcement` field and stays ignorant of checks. Removal is five deletions, listed in the brief and in `tools/kb/AGENTS.md`; after them the rules index is exactly the hand-typed one we have today. |
| 2 | **`enforcement` stays a stored field; the plugin owns its value.** `sync` derives it (`check.surface`, or `prose` when a rule has no check) and `audit` fails when stored ≠ derived. One writer, one checker, and the docs extension never learns a second field name. `gate` and `check` are mutually exclusive on a rule: `gate` is what would check a prose rule; once it exists it is a `#check`. |
| 3 | **Every check surface is one row in one table.** `surface → files that must mention the invocation` (`harness` → `tools/kb/package.json` scripts + the evidence file exists; `lint` → `.oxlintrc.json`; `tsc` → `tsconfig.base.json`; `hook` → `.githooks/pre-commit`; `ci` → `.github/workflows/*.yml`). No per-surface code path. Red cases per check (a fixture that must fail) are the harness tests' own job and are not modelled this wave. |
| 4 | **`SqliteStore` is an `EffectStore` over `bun:sqlite`, chosen by presence.** `<root>/.kb/kb.sqlite` present ⇒ sqlite; absent ⇒ JSONL; both present ⇒ `invalid_state`. The index stays `DatascriptIndex` in memory on both; an SQL-backed `KbIndex` needs an IR→SQL compiler and is a later decision. The tx log stays `MemoryTxLog` (the durable-log gap stays open; with sqlite it becomes a table, not `.kb/tx.jsonl`). One store contract test lives in `@kb/test-kit` and both adapters run it. |
| 5 | **The UI import table moves out of prose.** `ARCHITECTURE.md`'s "Import / ownership rules" becomes a path-level matrix in `harness/src/constraints.ts` beside the package matrix, enforced by one harness test over `packages/app/ui/src`. Today's violations use the two-mechanism rule by count: pinpoint `GAP [[id]]` on the import line up to ~30 sites, else a frozen baseline. The prose table is replaced by a pointer. |
| 6 | **Hotspots are split behaviour-preserving, one per wave, tests unchanged.** This wave: `canvas-page.tsx` (1834 lines, one component) into page shell / tool machine / selection / render layer, the machine a pure reducer with its own tests. `outline.store.ts` is not split yet: 18 test files hand-copy its reset literal (gap `01M1P63E3Y5KVHV3XMM6TBV2BM`); that gap closes first so the slice can move without an 18-file fan-out. |
| 7 | **Merge order and the review gate stand.** Coordinator reviews every branch against Rule 1 before merge; fix-ups are new tasks, never mailbox notes. |

## Waves

| id | brief | harness | depends on | scope |
|---|---|---|---|---|
| c1 | `briefs/c1-check-plugin.md` | codex | — → merged `36f57d1` (redispatched once as c1b) | `@kb/ext-check`: nodes, `audit`, `sync`, `check-audit` bin in the verify chain, existing rules linked to their harness checks, removal recipe |
| s1 | `briefs/s1-sqlite-store.md` | claude (opus) | — → merged `95d39be` | `@kb/store-sqlite`, presence-based selection in `layers.ts`, store contract test in `@kb/test-kit`, `store.migrate` action |
| u1 | `briefs/u1-ui-matrix.md` | claude (opus) | — → merged `db5b3c6` | `UI_ALLOWS` in `constraints.ts`, `ui-boundaries.test.ts`, violations under the two-mechanism rule, `ARCHITECTURE.md` table → pointer |
| u2 | `briefs/u2-canvas-split.md` | codex | u1 → merged `a110e7f` | `canvas-page.tsx` → shell / `tool-machine.ts` / selection / render layer, reducer tests |
| u3 | `briefs/u3-store-reset-fixture.md` | cursor | — → merged `7074808` | `resetOutlineStore()` fixture derived from the store's initial state, 18 files migrated, gap `01M1P63E3Y5KVHV3XMM6TBV2BM` closed |

Sequencing: all five branch from `main` @ `bd2303b`. Disjoint trees except:
c1 and every worker append to `.kb/nodes.jsonl` (coordinator merges by id
union, newest `updatedAt` wins); u1 and u2 both edit
`packages/app/ui/ARCHITECTURE.md` (u1 the import table, u2 the god-components
row — coordinator resolves). u2 merges after u1 so the split lands under the
matrix.

Standing rules: `intent/gate.sh session <harness>` first; kb CLI is
`bun tools/kb/packages/app/cli/src/main.ts …` (never the `kb` shim);
`.kb/nodes.jsonl` only through it; never hand-edit
`tools/kb/harness/lint-warn-baseline.json` (`bun run harness:snapshot`);
`bun run verify`, `bun test packages`, `bun run test:ui` green before every
commit; no push; report to `docs/kb/waves/2026-09-07/reports/<id>.md`, never
the repo root. Read `AGENTS.md` and `tools/kb/AGENTS.md` (Rule 1, Effect v4)
before code. A worker that needs a file it does not own stops and names it in
its report. A workaround is a `GAP [[id]]` plus a `#gap` node, never a comment.

## Not this wave, recorded as gaps by the worker who meets them

- SQL-backed `KbIndex` (IR → SQL) and a durable tx log as a sqlite table.
- Red-case fixtures per `#check`.
- `outline.store.ts` slices; `mutations.ts`; `field-value.tsx`; `sigma-graph.tsx`.
- IndexedDB `BrowserStore`; offline invocation replay.

## Close-out (2026-09-06)

All five waves merged to `main` @ `36f57d1`; every merge ran `bun run verify`
in pre-commit (now ending in `check:audit`), and the head passes
`bun test packages` (419 pass, 2 skip), `bun run test:ui` (94 files, 605),
`bun test harness` (68 pass, 1 GAP skip) and `kb checks: clean`. Each branch
was reviewed against Rule 1 before merge; verdicts: s1, u1, u3, c1 MERGE with
no findings; u2 MERGE WITH FIXES.

What the tree has now:

- `@kb/store-sqlite` beside `@kb/store-jsonl`, chosen by presence of
  `.kb/kb.sqlite`; one `storeContract` in `@kb/test-kit` that both run;
  `kb store migrate --to <jsonl|sqlite>` proven round-trip byte-identical on a
  copy of the live `.kb/`; `EffectStore.watchPaths` so the server asks the
  store what to watch. Incremental commit 122 ms → 4 ms on 50k nodes; bulk
  load a wash.
- `UI_ALLOWS` in `harness/src/constraints.ts`, 20 zones, enforced by
  `ui-boundaries`; 22 sanctioned breaches under 13 gaps; `ARCHITECTURE.md`
  points at it. The fence paid for itself inside the wave: it caught u3's new
  `test-support/` folder (row added in the merge) and u2's
  `lib/canvas-pointer.ts → components/canvas/edge-path` inversion
  (`edge-path.ts` moved to `lib/canvas-edge-path.ts` in the merge).
- `canvas-page.tsx` 1834 → 297 lines: a pure `lib/canvas-pointer.ts` reducer
  with rejecting-side tests, `use-canvas-doc` owning the persist contract, a
  render layer, a characterization test that passed unchanged. The last
  `eslint/max-lines` debt went with it and the ratchet promoted the rule to
  `error`.
- `resetOutlineStore()` derived from `initialOutlineState`; 18 suites stopped
  restating the store; gap `01M1P63E3Y5KVHV3XMM6TBV2BM` closed. The store
  slice is unblocked.
- `@kb/ext-check`: `#check` nodes (surface, evidence, invocation, blocking),
  `rule.check`, `ext.check.audit` with six finding kinds and a red case each,
  `ext.check.sync` deriving `enforcement`, `check:audit` closing `verify`.
  The five `enforcement-level` value nodes double as `check-surface`; `prose`
  stays enforcement-only. Rules index: 22 prose / 2 harness / 2 hook before,
  10 prose / 14 harness / 2 lint / 2 hook after. Removal recipe in
  `tools/kb/AGENTS.md#extensions`, verified on a scratch branch.

Coordinator fix-ups, each recorded where it landed:

- u2: `.oxlintrc.json` promotion (ratchet at zero) made by the coordinator
  after the worker stopped correctly on an unowned file.
- u2 review: two pre-existing pointer bugs the split preserved verbatim
  (`01M1TAE8HKYARYNTAVNMP566GV` move release persists the unsnapped delta;
  `01M1TAE8V1GDX971M2A6NC4DS1` Shift-resize anchor drift) — gapped, report
  corrected.
- c1 merge: the audit's first run on the merged tree flagged u1's rule home
  `constraints.ts#ui` (an anchor on a TypeScript file, from this plan's own
  brief) — home fixed, a `Check: ui-boundaries` node minted and linked, so
  the UI rule now derives `harness`. c1's in-memory store fixture gained
  s1's `watchPaths`.

Harness notes for the next coordinator: both codex workers and the cursor
worker asked ownership questions through `orca orchestration ask` and sat
blocked for 30–60 minutes because the coordinator's monitor swallowed a CLI
error (`--all --peek` are mutually exclusive) and never surfaced them. A
monitor that polls `orca orchestration inbox` and dedupes by message id is
the shape that works; a brief should also say what to do when an ownership
question gets no answer in ten minutes (c1b's did: make the smallest call,
record it, continue). The kb CLI stores `--prop field=<id>` as `str`; a ref
needs `kb set … --type ref`.

Open after this wave (gaps filed): SQL-backed `KbIndex`; durable tx log as a
sqlite table; red-case fixtures per `#check`; `outline.store.ts` slices;
`mutations.ts`; IndexedDB `BrowserStore`; the two canvas pointer bugs; ten
rules still `prose` (seven judgment rules, two advisory-by-design, and
`Effect v4 idiom` awaiting a `tsc` check).
