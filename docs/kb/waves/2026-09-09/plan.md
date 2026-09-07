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
| g1 | `briefs/g1-graph-options.md` | `domain/model` seed + graph schema, `ui/lib/graph-*`, both `.kb` stores | origin's option tags (no gap node — it never reached main) | dispatched |
| g3 | `briefs/g3-canvas.md` | `ui/components/canvas/**`, `ui/lib/canvas-*` | `01M1TAE8HKYARYNTAVNMP566GV` `01M1TAE8V1GDX971M2A6NC4DS1` `01M1MGCSQY0M708HYYTWHP0XP2` `01M1MGCT80E1FMXMEAEATS1VER` `01M1MGCS6A29HT51G40W5TEEYK` `01M1MGCTRFEHBF15DSCNDXW0GZ` `01M1RXNGSJT2J2VHDSYY7QJSD3` | dispatched |
| g4 | `briefs/g4-outline-keys-commands.md` | `ui/lib/*keymap*`, `ui/lib/run-command.ts`, `ui/components/outline/node-command-palette*`, outline keydown | `01M1MGCH7SD69CRSSV75X789QW` `01M1MGCDRS0K28YBF1Q86YY61S` `01M1MGCQKVQCG3H9YYCWQX0A0Y` `01M1MGCRNVNBE5HW27Z83PK67B` `01M1MGCF0ECBDEPTHPKMSQ4YFD` `01M1RXMQPVJKREGDS7D37J1MWN` (run-command part) | dispatched |
| g6 | `briefs/g6-backend-small.md` | `application/operations`, `app/server`, `ui/api/ws*`, `.gitattributes` + merge driver, `.oxlintrc.json` (one option), `ui/stores/outline.store.ts` (two deletions) | `01M1PJSSQYFV2E160JANGBPKCK` `01M1PK5NYA7ZG3XC0H0YRYRVZE` `01M1QZNM17MTGGPE517NVZYJT0` `01M1M08WYY9X6HFNN5GKDCC47E` `01M1MHKS8EV3DD378TZSX44EJG` `01M1R19NXBMTVQG6AH0S7VTC7D` `01M1MGT3K0DNGEQFXQNZYE83NY` `01M1MFS8RQ2BMQVZD02J4TQT7W` | dispatched |

Merge order: g1 first (makes the branch green), then g3 / g4 / g6 in the order
they finish. Coordinator reviews each against Rule 1 before merging.

## Batch 2 (after batch 1 is on main)

- g2 primitives: MdView, OntologyPicker, SidebarToggle, PrefFieldRow into
  `components/ui/`; `api/graph.ts` fixture; two outline components running
  DataScript directly; the live-query subscription out of a component.
- g5 editor registry: FieldRow, PropValueEditor, RefEditor hook, Bullet
  appearance, NodeBlock chrome, table columns, sort comparator.
- g7 durable tx log (`.kb/tx.jsonl` under the JSONL lock; table on sqlite) +
  saved-query virtual nodes as logged transactions.
- g8 domain typing: `parsePerspective`, `getViewConfig`, `KbNode.order`
  through one Schema each.
- g9 harness: suppression grammar to oxlint form (unskip), import-graph
  bypasses, pre-commit admission from the index snapshot.

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
