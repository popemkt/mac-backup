# kb wave 2026-09-09 — fold in origin's graph perspectives, then burn down gaps

Coordinator: claude (this session). Integration branch `kb-merge-origin` =
`main` @ `a6069bd` (kinds-not-tags) merged with `origin/main` @ `969dafa`
(relationship-driven graph perspectives, pushed by the owner 2026-09-07).
Owner directive: "pull from latest and merge it in as well, and probably ask
opus agents to fix outstanding stuff."

## Why an integration branch

The merge is clean on `verify` but red on `packages/domain/model/tests/kinds.test.ts`
(3 fails): origin seeds `#graph-renderer` and `#graph-source` as option-set
supertags with 15 option nodes, and `lens.renderer` names one by `targetTag` —
the exact shape wave 2026-09-08 retired. The fence caught it on first contact.
`main` stays green; g1 converts the options on the integration branch; `main`
fast-forwards once g1 lands. Every other batch-1 worker branches from
`kb-merge-origin` too and treats the 3 `kinds.test.ts` fails as known-red
owned by g1.

## Batch 1 (parallel, disjoint zones)

| id | brief | zone | gaps | status |
|---|---|---|---|---|
| g1 | `briefs/g1-graph-options.md` | `domain/model` seed + graph schema, `ui/lib/graph-*`, both `.kb` stores | origin's option tags (no gap node — it never reached main) | merged `7f56ea3`, reviewer MERGE no findings; `main` ff'd to it. `kinds.test.ts` green unedited. One UI flake seen once under 3 concurrent runs (`editor-behavior` D10), 3/3 green in isolation |
| g3 | `briefs/g3-canvas.md` | `ui/components/canvas/**`, `ui/lib/canvas-*` | `01M1TAE8HKYARYNTAVNMP566GV` `01M1TAE8V1GDX971M2A6NC4DS1` `01M1MGCSQY0M708HYYTWHP0XP2` `01M1MGCT80E1FMXMEAEATS1VER` `01M1MGCS6A29HT51G40W5TEEYK` `01M1MGCTRFEHBF15DSCNDXW0GZ` `01M1RXNGSJT2J2VHDSYY7QJSD3` | merged `27662dc`; 6/7 closed, gap 7 blocked → g2 |
| g4 | `briefs/g4-outline-keys-commands.md` | `ui/lib/*keymap*`, `ui/lib/run-command.ts`, `ui/components/outline/node-command-palette*`, outline keydown | `01M1MGCH7SD69CRSSV75X789QW` `01M1MGCDRS0K28YBF1Q86YY61S` `01M1MGCQKVQCG3H9YYCWQX0A0Y` `01M1MGCRNVNBE5HW27Z83PK67B` `01M1MGCF0ECBDEPTHPKMSQ4YFD` `01M1RXMQPVJKREGDS7D37J1MWN` (run-command part) | merged `0cd4283`; 5/6 closed + one third; filed `01M1XA98A0A7PWEPMHG2T4R5GP` (ui tests share store under parallelism) |
| g6 | `briefs/g6-backend-small.md` | `application/operations`, `app/server`, `ui/api/ws*`, `.gitattributes` + merge driver, `.oxlintrc.json` (one option), `ui/stores/outline.store.ts` (two deletions) | `01M1PJSSQYFV2E160JANGBPKCK` `01M1PK5NYA7ZG3XC0H0YRYRVZE` `01M1QZNM17MTGGPE517NVZYJT0` `01M1M08WYY9X6HFNN5GKDCC47E` `01M1MHKS8EV3DD378TZSX44EJG` `01M1R19NXBMTVQG6AH0S7VTC7D` `01M1MGT3K0DNGEQFXQNZYE83NY` `01M1MFS8RQ2BMQVZD02J4TQT7W` | merged `47eee74`; 6 closed, 2 half (JSONL fingerprint, read-set gate); merge driver live in this clone; filed `01M1X8VQT1P6E45NBTQEQ96YDR` (DST timeout under load) |

Merge order: g1 first (makes the branch green), then g3 / g4 / g6 in the order
they finish. Coordinator reviews each against Rule 1 before merging.

## Batch 1 close-out (2026-09-07)

`main` = `kb-merge-origin` @ `0cd4283`. Gates on that tip: verify green,
packages 449 pass / 0 fail, UI 891 / 891. 20 gaps closed, 2 half-closed, 2
filed. Coordinator fix-ups at merge: g4's new files carried four
`promise/always-return` disables that g6 had made unused (lint error) —
deleted; two live-store edits from the running kb UI committed as data before
each merge; the `nodes.jsonl` merge driver from g6 resolved the g4 store merge
by itself on first use. Reviewer notes: g4's "one line changed" claim about
its characterization tests understated — the diff is harness hardening
(`settle()`, polling reads, marker rewording), no assertion changed meaning.
Flakes seen under load (editor-behavior §3.3/D10, palette perf bar, DST
timeouts) are covered by gaps `01M1XA98A0A7PWEPMHG2T4R5GP` and
`01M1X8VQT1P6E45NBTQEQ96YDR`; not filed twice.

## Batch 2 (parallel, disjoint zones; base `kb-merge-origin` @ batch-1 tip)

| id | brief | zone | status |
|---|---|---|---|
| g2 | `briefs/g2-primitives.md` | `components/ui/` promotions, `api/graph.ts`, ds/live-query out of components, toast + canvas-api thirds, caret gap, gap 7 retry | merged `d177b5f`; 9/10 closed, fence 18→8 breaches, zero new rows; gap 10 blocked on `01M1RXMRJA3ZRAWPTB0ZH5YEYG` |
| g5 | `briefs/g5-editor-registry.md` | field editors registry, RefEditor hook, bullet appearance, row chrome, table columns, sort | merged `c90f6f8`; 7/7 closed, six `complexity` disables gone, max-lines 31→29 |
| g7 | `briefs/g7-durable-tx-log.md` | `KbTxLog` durable tail on both stores, migrate, saved-query virtual tx | merged `e48a70d`; 3 closed, 2 filed (`01M1XEZT8XZNSG1NGS9JPCQFGM` JSONL tail atomicity, `01M1XF05FV87AR22B4SAS0A2BK` virtual rev outside lock); reviewer fix: compaction bound hoisted to `TxTail` contract (`9b7feba`) |
| g8 | `briefs/g8-domain-typing.md` | `parsePerspective` / `getViewConfig` Schemas, `KbNode.order` discriminator | merged `a1c4337`; 3 closed, 1 filed (`01M1XF1NA2RBAX1E6NNX6PMZ6N` decode warnings reach log not UI); three deliberate behaviour changes on malformed view props, each reasoned in its test |

g2 and g5 both live in `components/outline/`; the briefs partition the files
and tell each to expect one-line import rewrites from the other.

## Batch 2 close-out (2026-09-07)

`main` = `kb-merge-origin` @ `a1c4337`. Gates on that tip: verify green,
packages 483 pass / 0 fail, UI 1052 / 1052. 22 gaps closed, 4 filed. All four
reviewers MERGE; g7's carried one Rule 1 finding (compaction bound declared in
both adapters), fixed by the coordinator before merge. Merge-time notes: the
g7 merge commit first failed pre-commit because `@kb/test-kit` gained a
workspace dependency and the integration tree needed `bun install`; every
store merge resolved itself through g6's driver; `rules.md` was the only file
to conflict in every batch-2 merge (regenerated each time). Three gap texts
were found wrong on contact and corrected with evidence (g2: `MdView` read
the store; `toast` `closes` inverts by the matrix; `canvas-api` already took
the node map). g8 reports the editor-behavior §3.3 flake as near-deterministic
under plain `bun run test:ui` on a loaded machine — gap
`01M1XA98A0A7PWEPMHG2T4R5GP` is more urgent than "seen once" suggested.

## Batch 3 (alone; touches comment lines repo-wide and the hook)

| id | brief | zone | status |
|---|---|---|---|
| g9 | `briefs/g9-harness.md` | suppression grammar (unskip), import-graph bypasses, pre-commit index-snapshot admission | merged `edb7f65`; 3/3 closed, none filed; 17 suppression sites (not 10) on one grammar; harness 69→85 tests; real tree had no import bypass |

## Not this batch (owner decision or external)

Two launch paths for the kb binary; agent-prompt rules port; branch
protection; SQLite index / IR→SQL; CLI cold start; browser holds whole graph;
BrowserStore IndexedDB; durable invocation replay; FTS5 (Bun segfault); React
index keys (by design); two upstream typing gaps; extension SDK bidirectional
typing; fail-closed ext admission; todo F close/split; pins update.

## Standing rules (unchanged)

`.kb/nodes.jsonl` only via `bun tools/kb/packages/app/cli/src/main.ts`; no
hand edits to `harness/lint-warn-baseline.json`; no push; no `rtk rebuild`;
reports under `reports/`; commits in the background (pre-commit takes minutes).

## Wave close-out (2026-09-07)

`main` = `kb-merge-origin` @ `edb7f65`. Gates on that tip: verify green
(harness 85 pass), packages 483 / 0, UI 1052 / 1052 (one gapped flake seen
once, green in isolation). Nine waves in three batches, every reviewer MERGE;
three carried fixes the coordinator applied before merge (g4 stale lint
disables, g7 duplicated compaction bound, g9 hook portability).

Totals, measured on the store rather than summed from reports: **39 gaps newly marked done, 2 half-closed, 6 filed.** Open gaps went 70 → 37 (83 total, 46 done). The per-wave reports sum higher because several waves verified gaps that earlier waves had already effectively closed.

**The new hook admitted its own merge on the third try**, and both refusals
were real:

1. `tar --exclude` after `-T -` — GNU tar (first on this machine's PATH via
   nix) ignores the excludes and exits non-zero; bsdtar (the worker's) accepted
   it. Options now precede the file list.
2. Checks running *inside* the snapshot inherited `GIT_DIR` / `GIT_INDEX_FILE`
   from the committing repository, so the harness's `git check-ignore`
   answered for the wrong repo and `gitignore-covers-derived` failed on every
   path. The worker's `git_own_env` scrubbed only the hook's own git calls;
   `in_snapshot` now scrubs the three checks too.

Both are in the merge commit's message. The worker's own commits passed the
hook because its worktree's `GIT_DIR` and its PATH's `tar` differed from the
coordinator's — a portability class the hook should be tested against
explicitly (bsdtar and GNU tar; a linked worktree and the main checkout).
Not filed as a gap: the fix is in, and the hook's first admission on `main`
is the test.

Seen once, not filed: a `bun run verify` run that started while the hook's
`intent/gate.sh record` step was still finishing failed
`suppression-grammar` on `git rev-parse --show-toplevel` (a lock race); the
immediate rerun passed 85/85. If it recurs, it is a gap on the harness
reading git while a commit is in flight.

**Still open and worth a wave each**, in the order they hurt:

- `01M1XA98A0A7PWEPMHG2T4R5GP` — UI suites share module state under vitest
  parallelism. g8 measured it near-deterministic under plain
  `bun run test:ui` on a loaded machine. Fix is per-file isolation in the UI
  vitest project or mutations that return their focus hand-off.
- `01M1RXMRJA3ZRAWPTB0ZH5YEYG` — field-value subscribes to the outline store;
  the last thing between `components/ui/` and holding the text host (gap 10).
  "Lands with the outline-store split" — the split is the wave.
- `01M1X8VQT1P6E45NBTQEQ96YDR` — DST scenarios inherit bun's 5 s timeout.
- `01M1XEZT8XZNSG1NGS9JPCQFGM` — JSONL tx tail not atomic with the node write.
- `01M1XF1NA2RBAX1E6NNX6PMZ6N` — config decode warnings reach the log, not a
  UI badge.

Owner-only items unchanged: push (`main` is now well ahead of `origin/main`),
`rtk rebuild`, pins (`cli-proxy-api` 7.2.152, `genoffice` 0.9.10), todo F
close/split, `docs/kb/check-feature.html` (untracked archify diagram, not
touched).
