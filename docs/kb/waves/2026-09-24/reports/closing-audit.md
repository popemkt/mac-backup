# Closing audit: kb wave 2026-09-24

This audit is read-only and was judged at `main` `ca062302`. While it ran, someone else moved `main` to `3595ecfa`, a merge of the bot's release-source refresh (#13) that touches only `_sources/`. Nothing in `/Users/popemkt/.dotfiles` was edited, staged or committed. `git status` still shows only the pre-existing `M modules/common/home-manager/npm-global.nix`.

Evidence lives under `~/.cache/kb-wave-2026-09-24/audit/`:

| Folder | What it holds |
|---|---|
| `shots/` | 76 screenshots: headed Chrome with WebGPU, all 6 design-system × light/dark combinations, all 5 renderers, the 4 lab studies |
| `scratch/` | store and rank repros, the md-inline repro, the chip contrast script |
| `tests-scratch/` | test and render-suite runs |
| `mod-scratch/` | knip and lint output |
| `design-scratch/` | spec-drift working notes |

## Gate state at HEAD

| Check | Result |
|---|---|
| `bun run test` | 570 pass, 2 env-gated skips |
| `bun run test:ui` | 1215 pass |
| `bun run harness` | 101 pass |
| `bun run lint` | 0 errors; 86 warnings, all within the baseline |
| `bun run knip` | 68 findings, equal to the frozen ledger |
| `bun run test:render`, run 1 | 16/16 |
| `bun run test:render`, run 2 | 15/16: `dark Retina graph labels` failed |
| Console | 0 errors, warnings or page errors across every view, renderer, theme and study |

## Orchestrator's notes, item by item

| Note | Verdict | Finding |
|---|---|---|
| Reads mutate the store | **Confirmed**, and worse than noted: one read after a `kb add` appends a **261 KB** tx frame covering the whole graph (`tx.jsonl` went from 314 B to 261 KB) | P0-1 |
| `kb add` never ranks | **Confirmed**. Ranking lives only in the UI (`ui/src/actions/plan.ts:146,343`) | P0-1 |
| Rank key growth | **Confirmed**, and keys also **collide**: `rankBetween("…yh","…yhh")` returns `"…yhh"`. There are 37 duplicate-rank groups among the 228 committed roots | P0-2 |
| Intraword `_` treated as emphasis | **Confirmed** in the outline (renders `<em>`) and in graph labels, where the characters are *deleted* ("reconcileclaudedirect_routing") | P1-4 |
| docs-check stale path | **Confirmed** at `docs-check.ts:30` | P2-14 |
| Merge driver has no fallback | **Confirmed**: the imports run at top level, before the `try` | P1-3 |
| Tag-chip contrast | **Confirmed. All 12 palette colours fail AA in every light theme** (worst 1.67:1) | P1-5 |
| nvfetcher passthru mirror | **Already fixed** in the wave (`792b6eff`). A P3 `meta.homepage` restatement remains in 3 `pkgs/*/default.nix` | P3 |
| `test:render` not in CI | Confirmed. The suite is also flaky today, so it cannot gate until P1-9 is fixed | P1-9, D-3 |
| Status table overwritten on rebase | Confirmed: `79c98532` reverted rows a and c and dropped h and z; `d16c4a02` repaired it by hand | D-4 |
| `land.sh` / `rebase-resolve.sh` discard the order backfill | Confirmed. Harmless once P0-1 lands; until then it hides the creation gap | P0-1 |

---

## Prioritised findings

Paths are relative to `tools/kb/packages/app/ui/src/` unless they start with `tools/`, `packages/`, `harness/`, `.github/`, `docs/` or `.kb/`.

### P0

**P0-1 · data. Creating a node doesn't rank it, and every later open rewrites the whole store.**
- **Evidence:**
  - `node.add` sets `order` only when the caller passes one, and the CLI and MCP never do (`packages/application/operations/src/actions.ts:330-337`).
  - When `migrateOrderKeys` reports any change, `openKbEffect` commits every node (`upserts: nodes`) (`packages/app/runtime/src/layers.ts:66-74`).
  - Repro in `scratch/root`:
    1. A read on a clean store leaves its md5 unchanged.
    2. `kb add "audit probe root"` stores `order: null`.
    3. `kb search probe` writes the rank `zzzzzzzzzy` + 96×`h`, rewrites `nodes.jsonl`, and grows `tx.jsonl` from 314 B to 261 KB.
  - `DESIGN.md:368-373` and `packages/domain/model/src/model.ts:42` say a missing rank happens "only on a row minted before fractional ordering existed". Current behaviour contradicts that.
  - Ranking is a Rule 1 mirror: the UI owns sibling ranking and the create operation does not.
- **Impact:**
  - Every CLI or MCP write leaves the committed store dirty after the next read, so worktrees go dirty and `land.sh` has to `git checkout` the store back.
  - The tx log grows by the whole graph each time (the repo's `.kb/tx.jsonl` is already 1.6 MB).
  - Live clients receive a full-graph frame.
- **Fix:**
  1. `node.add` (and any insert or move that lacks `order`) derives the rank on the server from the target sibling group, through one `rankForInsert(siblings, position)` in `@kb/model`.
  2. The UI sends only the position, which deletes its copy of ranking.
  3. `openKbEffect` commits only the nodes whose content changed, never the whole set.
  4. Opening never writes when the only change is a rank that can be derived (see D-6).
  5. Rewrite `DESIGN.md` → Domain typing to match.
  6. Drop the backfill discards from `land.sh` and `rebase-resolve.sh`.
- **Effort:** M. **Safe now:** yes.

**P0-2 · data. Tail ranks halve toward MAX, then grow by one character per append, and collide.**
- **Evidence:**
  - `rankBetween(before, undefined)` takes the midpoint between the last key and `MAX`, so each append at the tail halves the remaining gap (`packages/domain/model/src/order.ts:53-61`). The gap runs out after 52 appends (measured), and from then on the function appends `"h"`.
  - `decode` reads only the first 10 characters (`:14`), so all suffixed keys decode as equal and every further append grows by one character (158 characters after 200 appends).
  - Inserting between two suffixed keys returns the upper bound itself: `rankBetween("zzzzzzzzzyh","zzzzzzzzzyhh") === "zzzzzzzzzyhh"`.
  - In the committed store:
    - 128 of 436 nodes have keys longer than 10 characters, up to 105.
    - 37 groups of roots share a rank, e.g. "Hola" and "KB Engineering" both have `zzzw4qelqg`. Separate branches each ranked a new tail deterministically, and `mergeNodeSets` ignores `order` when merging them.
  - `order.ts:57-59` promises a "later maintenance pass". There is none, and the deferral has no GAP marker.
  - Root ordering is implemented twice with different comparators:
    - `order.ts:88-95` compares code points and breaks ties by id;
    - `lib/graph-view.ts:80-87` uses `localeCompare` and keeps input order on ties.
  - `lib/graph-view.ts:77` also contains a dead `void byId`.
- **Impact:** root order is ambiguous and can differ between store and UI; keys grow without bound; inserts silently tie.
- **Fix:**
  1. Use variable-length fractional indexing, so tail appends *step* rather than halve and `between(a, b)` is always strictly between.
  2. Add a property test: `a < between(a, b) < b`, including long keys.
  3. Add a one-shot re-spread of duplicate or over-long sibling groups that keeps the visible order, and run it on both stores.
  4. Re-rank duplicate groups after a merge, in `mergeNodeSets` or in the driver.
  5. Export one `compareRootOrder` from `@kb/model` and use it in both places.
- **Effort:** M. **Safe now:** yes, together with P0-1.

### P1

**P1-1 · data. A replace is sent as two transactions, and committed data is already corrupted by it.**
- **Evidence:**
  - `actions/plan.ts:416` builds a replace as `unset` + `set`, and `actions/optimistic.ts:20` sends them separately: 5 renderer clicks produced 10 transactions.
  - Committed `lens.all-mentions` has `sys.f.lens.link-distance: [95, 96]`.
  - Wave item (a) checks value types but not cardinality, so nothing rejected the second value.
- **Impact:** other clients see a window with no value, and overlapping edits leave single-valued settings with several values.
- **Fix:**
  - Send one atomic `node.update` carrying both `unsetProps` and `setProps`.
  - Repair the node with `kb unset`.
  - Optionally enforce cardinality (D-7).
- **Effort:** M. **Safe now:** yes, apart from D-7.

**P1-2 · data/UX. CLI writes don't reach a running UI.** Reported by the UX walk; I have not reproduced it myself.
- **Evidence:**
  - With `kb ui` running on `uxroot`, `kb add` wrote both files, but `/api/graph` stayed at rev 54 for more than 60 s. The node appeared only after a restart.
  - `ingestExternalWrite` exists at `packages/app/server/src/server.ts:91,301`.
- **Impact:** a CLI, MCP or agent writer is invisible until the server restarts. That contradicts the tx-tail spec ("a CLI write is already in it when the watcher fires").
- **Fix:** diagnose the watcher, probably around the lock-then-rename write path, and add a two-process test: server up, CLI write, assert a WS frame arrives within N seconds.
- **Effort:** M. **Safe now:** yes.

**P1-3 · data. The merge driver crashes without a fallback.**
- **Evidence:**
  - `packages/app/cli/src/bin/merge-jsonl.ts:19-20` imports `@kb/model` and `@kb/runtime` at top level, so "module not found" is thrown before the `try` at `:59`, and git reports a conflict with no explanation.
  - It pulls in all of `@kb/runtime` just for `writeErr`.
  - `tools/kb/AGENTS.md` says git "falls back to the default text merge". That holds when the driver is unregistered, not when it is registered and crashes.
- **Fix:**
  - Register a POSIX wrapper, `tools/kb/bin/merge-jsonl`, that checks for `bun` and `node_modules` and otherwise runs `git merge-file -p %A %O %B` with a one-line hint and a non-zero exit.
  - Import only `@kb/model` and write to `process.stderr`.
  - Update the registration snippet.
- **Effort:** S. **Safe now:** yes. Each clone has to re-register the driver once.

**P1-4 · UX/data. Underscores inside words become emphasis.**
- **Evidence:**
  - `lib/md-inline.ts:182-204` has no word-boundary check.
    - `snake_case_name` parses as `snake` + *case* + `name`.
    - `Review reconcile_claude_direct_routing.py` parses as `reconcile` + *claude* + `direct_routing.py`.
  - `lib/graph-label.ts:70` joins the parsed segments, which drops the underscores entirely.
  - Screenshots: `shots/outline-kb-light.png`, `shots/graph-r-force2d.png`.
- **Fix:**
  - Apply the CommonMark flanking rule for `_`/`__`: a delimiter with an alphanumeric on its left cannot open, and one with an alphanumeric on its right cannot close. `*` may still be intraword.
  - Test `a_b_c`, `snake_case_name`, `__init__.py`, `_em_`, and that graph labels round-trip the text.
- **Effort:** S. **Safe now:** yes.

**P1-5 · UX/design. Tag chips fail AA, bypass the tag-colour module, and escape the contrast guard.**
- **Evidence:**
  - `components/outline/tag-chip.tsx:71-73` and `components/ontology/ontology-page.tsx:352` use `` `${color}18` `` as the background and the raw colour as text.
  - That is the exact pattern `lib/tag-color.ts:10-13,74` forbids (it "produces garbage" for `red` or `oklch(…)`); `tagColorAlpha` exists for this.
  - Measured contrast over the ~9.4 % tint:

    | Theme | Palette colours failing 4.5:1 | Worst ratio |
    |---|---|---|
    | kb light | 12/12 | 1.80 |
    | paper light | 12/12 | 1.68 |
    | terminal light | 12/12 | 1.74 |
    | kb dark | 2/12 | 4.13 |
    | paper dark | 4/12 | 3.72 |
    | terminal dark | 2/12 | 4.14 |

  - In the browser, `project` measures 1.67–1.81 and `todo` 2.36–2.55.
  - The AA guard in `lib/design-systems.test.ts` checks colour classes only, never inline styles.
- **Fix:**
  - One `tagChipColors(color, appearance)` in `lib/tag-color.ts`:
    - background: `tagColorAlpha(color, 12)`;
    - text: `color-mix(in oklab, <color>, var(--foreground) k%)`, where `k` is a per-design-system token (`--tag-ink-mix`) that puts every `TAG_PALETTE` entry at 4.5:1 or better.
  - Both call sites use it.
  - The guard tests palette × design system × appearance through that function.
- **Effort:** M. **Safe now:** yes.

**P1-6 · UX. A query node with bad syntax shows "Loading results…" forever.**
- **Evidence:**
  - `lib/use-query-node-rows.ts:38-47` only ever sets the error to `null`.
  - `lib/query-node.ts:81` `subscribeQueryNode` has no error callback, although the protocol defines an error message.
  - So the error branch at `query-results.tsx:64` can never run while connected (`shots/qrow-bad.png`, `query-bad.png`).
- **Fix:** pass the error through, and add a component test.
- **Effort:** S. **Safe now:** yes.

**P1-7 · UX. After ⌘. zoom, the keyboard is broken.**
- **Evidence:**
  - `stores/outline.store.ts:509-518`: `zoomTo` selects the zoom root, which is not a visible row.
  - `App.tsx:263-272` then opens the node palette with no row to anchor to.
  - Every typed key toasts "That node is not visible in this outline"; typing "View as" produced 5 toasts (`shots/palette-table.png`).
  - ⌘K opens nothing.
- **Fix:** after zooming, select the first visible child or nothing; add a test for zoom → ⌘K → type.
- **Effort:** S. **Safe now:** yes.

**P1-8 · UX/visual. Tree and Cluster are unreadable at their defaults.**
- **Evidence:**
  - Tree squeezes 314 nodes into a sliver about 60 px wide (`shots/graph-r-tree.png`).
  - Cluster labels pile on top of each other and reach full opacity while nodes are still fading in (`graph-r-cluster.png`, `-400ms.png`).
- **Fix:**
  - Tree: collapse to depth 2 by default, lay out horizontally, fit to the root.
  - Cluster: reuse `lib/graph-label-layout.ts` and fade labels in after nodes.
- **Effort:** M. **Safe now:** yes.

**P1-9 · tests. The render suite is flaky and depends on test order.**
- **Evidence:**
  - `packages/test-support/render-tests/tests-render/render.e2e.ts:337-384` `dark Retina graph labels` failed in 1 of 2 full runs and 3 of 4 repeats:
    - it reads `__kbSigma` without waiting (`:340`);
    - the 3D canvas didn't appear within 5 s (`:384`);
    - `getByText('Fixture root')` matched 58 elements.
  - Every test persists its renderer choice to the one shared server on port 4323, breaking `harness-server.ts:49-55` ("a spec that writes gets its own instance").
  - The fixture seeds from the working tree's `.kb` (`tests-render/server.ts:10-19`).
  - Fixed 6 s and 4 s waits stand in for a settled check.
  - `retries: 1` under CI would hide all of this.
- **Fix:**
  - Poll `__kbSigma` and `__kbForce3d.inspect()`; use exact or test-id locators.
  - Reset the renderer in `beforeEach`, or give the file its own harness.
  - Seed from `systemSeedNodes()`.
  - Poll a settled flag instead of fixed waits.
  - `retries: 0`.
- **Effort:** S–M. **Safe now:** yes.

**P1-10 · modularity (Rule 1). Sky copies screen projection, with the bug the original fixed.**
- **Evidence:** `components/lab/sky/scene.ts:166-169` tests `projected.z > 1`, which `components/graph/force3d-screen.ts:5-9,28-42` documents as wrong under WebGPU.
- **Fix:** move it to `scene/gpu/screen.ts`; the graph and Sky both use `toScreen`.
- **Effort:** S. **Safe now:** yes.

**P1-11 · modularity (Rule 1). The scene-host mechanism exists twice.**
- **Evidence:**
  - `components/lab/kit/scene-host.tsx:26-90` and `components/graph/force3d-graph.tsx:82-155` each handle visibility, `ResizeObserver`, `visibilitychange` and dispose.
  - `LabScene` (`kit/contract.ts:86-100`) and `Force3dScene` (`force3d-scene.ts:95-108`) declare the same handle.
  - Running and reduced-motion gating is duplicated (`kit/study.ts:40-100`, `force3d-scene.ts:143-160,570-585`).
  - The copies have drifted: the graph writes refs during render (`force3d-graph.tsx:166-169,204`), which is where the new `react/refs` warnings come from.
- **Fix:** `scene/host.ts` with a `SceneHandle` type and a non-React `attachScene(el, handle)`, used by both hosts.
- **Effort:** M. **Safe now:** yes (see D-8).

**P1-12 · design. The warn ratchet was raised, not held.**
- **Evidence:**
  - `972e3d23` (item g) raised `react/refs` from 22 to 26 in `harness/lint-warn-baseline.json`.
  - It also froze 5 new knip entries: `COOLDOWN_TICKS`, `PARTICLES_PER_LINK`, `motionDuration`, `Force3dInspection`, `SigmaTargets`.
  - That breaks "a rise fails the build" and makes gap `01M35NJQPKW5YVNVFFAFAYXPFH` untrue.
- **Fix:**
  - The harness compares the baseline against the merge-base and fails when any count rises.
  - Drain the new warnings (P1-11) and un-export the 5 symbols.
  - Lower the baseline.
- **Effort:** M. **Safe now:** yes.

**P1-13 · design/data. A second committed store catches writes.**
- **Evidence:**
  - `tools/kb/.kb/nodes.jsonl` has 97 nodes, 96 of them seed nodes.
  - `packages/app/runtime/src/root.ts:7` walks up from the current directory, so any `kb` run inside `tools/kb` writes there.
  - The wave rewrote this file 4 times. Neither the harness nor the rules index reads it.
- **Impact:** a gap added from `tools/kb` lands in the wrong store without any warning.
- **Fix:**
  - Delete the store and gitignore `tools/kb/.kb/`.
  - Have `tools/kb/bin/kb` pass the repo `--root`, or make discovery refuse a nested `.kb`.
  - Remove its line from `.gitattributes`.
- **Effort:** S. **Needs your decision (D-2).**

### P2

**P2-1 · visual/UX. The first screen of home is a wall of about 100 root-level `GAP:` rows** (`shots/outline-kb-light.png`).
- **Cause:** `#gap` and `#rule` nodes are forest roots, and every new one lands at the tail.
- **Fix:** a parent index node (like "Rules index"), or a home filter (D-5).
- **Effort:** S–M.

**P2-2 · visual. Light modes look flat next to the lab.**
- **Graph:**
  - In light mode, graph nodes are flat dots on white with black labels (`graph-kb-light.png`).
  - Paper light labels are washed out.
  - 2D labels tiny leaves while hubs such as "kb" stay unlabelled.
  - Embers in light mode is muddy (`lab-embers.png`).
- **Graph fix:**
  - Rank label priority by degree in the shared label layout.
  - Give light stages a ground (vignette or grain) and node glow through the scene palette.
  - Settle nodes in from the hubs over 300–400 ms.
  - Give Embers a light ramp, or force a dark stage.
- **Outline:**
  - The count badge overlaps the bullet.
  - Chips need a quieter style.
  - Apply the zoomed header's tinted wash at home too.
- **Effort:** M–L. See D-9 for the default renderer.

**P2-3 · UX. Tag palette collisions.**
- **Evidence:**
  - `todo` and `ontology` share `#f97316`.
  - `gap` `#14b8a6` and `rule` `#10b981` are nearly the same.
  - Untagged (107 nodes) is the same indigo as `canvas` (`lib/tag-color.ts:20`).
- **Fix:** when a hash collides with a tag in use, take the next free slot; give Untagged a neutral grey.
- **Effort:** S.

**P2-4 · UX. Not-found states are inconsistent.**

  | Route | What it shows |
  |---|---|
  | `/canvas/NOPE` | bare red text |
  | `/o/NOPE` | an empty state under an "Untitled ontology · 0 members" header |
  | `/graph/NOPE` | silently shows All mentions |
  | `/nope/xyz`, `/lab/nope` | silently show the outline under the wrong URL |

- Screenshots: `shots/bad-*.png`.
- **Fix:** one shared `NotFound` component; no ontology chrome when there is no ontology.
- **Effort:** S–M.

**P2-5 · UX. Toasts stack without deduplication and are translucent.**
- **Fix:** deduplicate by message, cap at 3, use an opaque surface.
- **Effort:** S.

**P2-6 · UX. Table, board and cards views are hard to reach.**
- **Evidence:** a zoomed list node has no view chrome (`components/outline/zoomed-root-header.tsx:141`), and home has no view switch.
- **Fix:** a quiet view control, shown on hover or focus.
- **Effort:** S.

**P2-7 · UX. Narrow screens are broken.**
- **Evidence:** at 390 px the page scrolls sideways (520 px wide on outline, 459 px on graph), words break mid-word, and the toolbar overlaps the legend (`narrow-*.png`).
- **Fix:** the sidebar becomes an overlay below 768 px.
- **Effort:** M.

**P2-8 · UX. Ontology graph and legend polish.**
- The ontology graph has two stacked headers, and its edgeless nodes are drawn as 4 px dots in the corners (`ontology-graph.png`).
- In the treemap, the legend covers the first tile.
- In terminal, the legend's last row is clipped (`components/graph/graph-legend.tsx:94` `max-h-64`).
- The zoomed title is clipped with no ellipsis.
- **Effort:** S each.

**P2-9 · tests. The lab studies never run in a browser.**
- **Evidence:**
  - No render spec visits `/lab`, and the acceptance test mocks Embers.
  - Untested: `scene-host`, `pointer`, `lab-page`, `studies`, dispose on switch, and the no-WebGPU fallback (`embers/scene.ts:83`).
- **Fix:** one spec per study, skipped when WebGPU is missing, with a GAP marker.
- **Effort:** M.

**P2-10 · tests. The scene kit is mostly untested.**
- **Evidence:**
  - These have no unit tests: `scene/gpu/stage.ts` (343 lines), `rig.ts`, `tsl.ts`, `starfield.ts`, `shade-ops.ts`, `scene/palette.ts`, `force3d-links.ts` and `sigma-emphasis.ts`.
  - No e2e test asserts `backend`, so a WebGL2 fallback would pass silently.
- **Fix:** unit-test the pure parts, and annotate `backend` in the e2e.
- **Effort:** M.

**P2-11 · tests. The design-system switch is never tested in a real browser.**
- **Fix:** a per-system e2e comparing the computed `--background` and `--primary` with `SHEETS.resolve`.
- **Effort:** S.

**P2-12 · modularity. `mountForce3d` is a 476-line closure.**
- **Evidence:**
  - `components/graph/force3d-scene.ts:141`.
  - It is missing from the god-component table in `ARCHITECTURE.md`.
  - Its pointer and pick code (`:370-432`) copies `lab/kit/pointer.ts`.
- **Fix:**
  - Move `PointerField` into `scene/`.
  - Split out pick, emphasis and the API object.
- **Effort:** M.

**P2-13 · modularity (Rule 1). Smaller duplicates in the scene area.**

  | What | Where | Fix |
  |---|---|---|
  | Dark-mode detection | `force3d-scene.ts:620-627` `darkGround` guesses from luminance | pass `Appearance.dark` (`stores/prefs.store.ts:200-221`) |
  | Shadow setup | `scene/gpu/rig.ts:41` `createRig(…, shadows: boolean)`, repeated in `lab/{light,motion}/scene.ts` | a `StageOptions.shadows` option |
  | AO flag | `options.ao` re-checked 4× (`stage.ts:115,122,288,323`) | decide once |
  | Bloom threshold `1` | 3 places (`stage.ts:134`, `lab/embers/heat.ts:71`, `force3d-light.ts`) | export `BLOOM_THRESHOLD` from `scene/shade-ops.ts` |
  | Inline `exp(-k·dt)` | 4 places (`force3d-links.ts:165`, `lib/graph-fade.ts:78`, `stage.ts:199`, `lab/kit/velocity.ts:31`) | use `lib/timing.ts:132` `approach()` (Lab M1, M6, P4) |
  | Layer disposal | `disposeLayer` (`force3d-scene.ts:637-647`) re-implements `disposeGraph` | use `disposeGraph` |
  | "Selection beats hover" | 3 places (`force3d-emphasis.ts:108`, `sigma-graph.tsx:92`, `tree-graph.tsx:277`) | one rule in `lib/graph-interaction.ts` |

- **Effort:** S each.

**P2-14 · design. Stale statements.**

  | Where | What is wrong | Fix |
  |---|---|---|
  | `packages/app/cli/src/bin/docs-check.ts:30` | names `tools/kb/src/bin/docs-materialize.ts`, which no longer exists | name `packages/app/cli/src/bin/docs-materialize.ts` |
  | `tools/kb/AGENTS.md:33`, `tools/kb/README.md:11`, `.githooks/pre-commit:155`, `.github/workflows/validate.yml:66` | restate what `verify` runs, and get it wrong (they add knip and omit fmt:check and check:audit) | point to `package.json` |
  | `DESIGN-UI.md:972` | calls the amber-chip gap open; it was fixed in `890521a2` | say it is closed |
  | `docs/ci.md:120-125` | says 15 WebGL specs | 16 specs, on WebGPU with a WebGL2 fallback |
  | `DESIGN.md:461`, `lib/field-type.ts:5,43`, 3 tests | name `@kb/field-type`, a dead alias | say `@kb/model` |
  | `.oxlintrc.json` | exempts stories, harness and config files from the token lint, which is wider than `DESIGN-UI.md:941` and `AGENTS.md:57` say | document or narrow |
  | Plan row g | claims link particles and fly-to are shared with the lab | they are graph-only |

- **Effort:** S.

**P2-15 · design. GAP markers can point at closed gaps, and some nodes are stale.**
- **Evidence:**
  - `components/palette/command-palette.tsx:24` and `lib/commands.tsx:21` cite gap `01M1RXMQPVJKREGDS7D37J1MWN`, which is done, and whose `current` field is out of date.
  - Gap `01M3A8QG4PEQK0A9N3KPQ3K98X` names `kit/stage.ts`, which is now `scene/gpu/stage.ts`. The generated `docs/kb/rules.md:332` repeats the stale path.
  - Rule `01M3A8KH2G236XGK7BNMSGF8PT` says "the one lab kit", and its scope leaves out the graph views.
  - Complexity gaps `01M1MGCPJTV66QSFCR44XG29YM` and `01M1MGCQ3JT5GE3FY5XJ9EB67Q` look already fixed.
  - The compaction deferral in `order.ts:57-59` has no marker.
- **Fix:** make `harness/tests/gap-markers-resolve.test.ts` fail on markers that point at done gaps; fix the nodes and materialize.
- **Effort:** S.

**P2-16 · CI. The CI kb job runs `bun-version: latest`, outside `nix develop`.**
- **Evidence:** `.github/workflows/validate.yml`. Pre-commit uses the flake's Bun, so the two can differ.
- **Fix:** pin it from the flake, or run inside `nix develop`.
- **Effort:** S.

**P2-17 · tests. Mutation testing covers only `domain/model`.**
- **Evidence:** `stryker.config.json`. It misses `reach` (`domain/query/src/ir/*`) and `operations/src/map.ts`, and fast-check runs unseeded.
- **Decision:** D-10.
- **Effort:** S.

### P3

- **Keyboard and focus:**
  - After Esc, focus lands on `<body>`.
  - There is no skip link (12 Tabs from the sidebar to the graph controls).
  - The `"node-palette"` action in `lib/keyboard-shortcuts.ts:2-16` is dead, and `App.tsx:263` re-checks the key itself. Wire the action or delete it.
- **Header jargon:** "sys off" and "rev 54 · api".
- **Tests:**
  - The skip-pairing regex (`harness/tests/skip-pairing.test.ts:19`) misses `skipIf`, `test.if`, `fixme` and in-body `test.skip(cond)`.
  - The item (a) type check is untested through MCP, HTTP and WS.
  - `unset` with a typed value is untested.
  - There are fixed sleeps in `graph-page.component.test.tsx:91,115`.
  - `force3d-layout.test.ts:77-79` polls, then carries on silently if the condition never holds.
  - `value-conformance.test.ts:23` and 8 older tests create `kb-*` temp dirs inside the source tree, which are not gitignored.
  - The solid-pair contrast check has no red case; add black on white = 21:1.
- **Modularity:**
  - Three hand-kept `three-import.boundary.test.ts` copies (D-11).
  - `ui/index.html:24-47` restates the prefs constants (D-12).
  - `lib/css-color.ts:142-148` `TOKEN_FALLBACK` is not bound to the CSS by any test.
  - `knip.json` has redundant ignores (`zod`, `harness/src/snapshot.ts`).
- **Design:**
  - Split the Lab principles rule into measured bounds (already tested: `lib/timing.test.ts:39`, the boundary tests, the Embers pop budget) and a prose remainder.
  - Test that the principle-id union in `lab/kit/contract.ts:15-34` matches the ids in `DESIGN-UI.md`.
  - "Coverage is a signal", "Mutation is advisory" and "Effect v4 idiom" can move off `prose`.
  - `kb-code-walkthrough.html` is fully stale (D-13).
  - `components/graph/graph-page.tsx:55-70` writes `localStorage` directly.
  - `meta.homepage` is restated in `pkgs/{cli-proxy-api,genoffice,chat2db}/default.nix`.

---

## Work packages

Each package is one branch, and no two edit the same files. The one shared file is `.kb/nodes.jsonl`, which is merged by node id and where each package touches different nodes. Run any node edits with `--root` pointed at the package's own worktree.

**WP1: store, rank and writes.** Covers P0-1, P0-2, P1-1, P1-3, and P1-13 after D-2.
- **Files:**
  - `packages/domain/model/src/{order,merge,model,index}.ts` and tests
  - `packages/application/operations/src/actions.ts`
  - `packages/app/runtime/src/{layers,root}.ts`
  - `packages/app/cli/src/bin/merge-jsonl.ts`, the new `tools/kb/bin/merge-jsonl`, `tools/kb/bin/kb`
  - `ui/src/actions/{plan,optimistic}.ts`, `ui/src/lib/graph-view.ts`
  - `packages/app/test-kit/src/harness.ts`
  - `DESIGN.md` → Domain typing, and the merge-driver block of `tools/kb/AGENTS.md`
  - `.gitattributes`, `land.sh`, `rebase-resolve.sh`
  - the one-shot re-rank, and the `lens.all-mentions` repair
- **Order:** rank, then create and open, then replace, then driver, each as its own commit.
- **Effort:** L.

**WP2: live sync.** Covers P1-2.
- **Files:** `packages/app/server/src/server.ts` and the watcher, and a new two-process test in `packages/app/server/tests/`.
- **Effort:** M.

**WP3: outline text, colour and states.** Covers P1-4 to P1-7, P2-3 to P2-7, and the P3 keyboard, focus and header items.
- **Files:**
  - `ui/src/lib/{md-inline,tag-color,query-node,use-query-node-rows,keyboard-shortcuts}.ts` and tests
  - `ui/src/lib/design-systems.test.ts`
  - the `--tag-ink-mix` token only, in `design-system.css` and `design-systems/{paper,terminal}.css`
  - `components/outline/{tag-chip,query-results,zoomed-root-header,outline-column}.tsx`
  - `components/ontology/ontology-page.tsx`
  - `stores/outline.store.ts`, `App.tsx`
  - the toast component, a new `NotFound`, the canvas not-found view, the sidebar layout
- **Effort:** L. Can be split into 3a (`lib`, chips and contrast) and 3b (interaction and states).

**WP4: graph and scene kit.** Covers P1-8, P1-10, P1-11, the code half of P1-12, the graph and Embers half of P2-2, P2-8, P2-12, P2-13, and the P3 `TOKEN_FALLBACK`, `graph-page` localStorage and knip items.
- **Files:**
  - `ui/src/scene/**`, `components/lab/**`
  - `components/graph/**`, including its component and layout tests
  - `lib/{graph-fade,graph-interaction,graph-label-layout,css-color,timing}.ts`
  - `harness/lint-warn-baseline.json`, `knip.json`
  - `packages/app/ui/ARCHITECTURE.md`
- **Order:** host and screen, then stage and rig, then the `mountForce3d` split, then renderer readability and the visual pass, then drain the baseline.
- **Effort:** L.

**WP5: tests, CI and docs hygiene.** Covers P1-9, the harness half of P1-12, P2-9, the e2e half of P2-10, P2-11, P2-14 to P2-16, and the P3 test and rule items.
- **Files:**
  - `packages/test-support/render-tests/**`
  - `harness/tests/{lint-warn-ratchet,gap-markers-resolve,skip-pairing}.test.ts`
  - `packages/app/cli/src/bin/docs-check.ts`
  - the temp-dir tests, and new MCP/HTTP/WS type-check tests in new files
  - the GAP comment lines in `components/palette/command-palette.tsx` and `lib/commands.tsx`
  - the alias comment in `lib/field-type.ts`
  - `tools/kb/{README.md,DESIGN-UI.md,.oxlintrc.json}`, and the `verify` line in `AGENTS.md` (a different block from WP1's)
  - `.githooks/pre-commit`, `.github/workflows/validate.yml`, `docs/ci.md`, `.gitignore`
  - the gap and rule nodes, then materialize
- **Effort:** M.

**Order:** all five can start now. Gate CI on `test:render` (D-3) only after WP5 lands.

---

## Needs your decision

1. **D-1, the rank algorithm.** Replace the fixed-width rank with variable-length fractional indexing, plus a one-shot re-rank? That rewrites the `order` of about 130 nodes in one commit. Recommended.
2. **D-2, the nested store.** Delete `tools/kb/.kb/`, and have root discovery refuse a nested store? Say if it has a purpose I missed.
3. **D-3, render tests in CI.** Gate CI on `test:render` after WP5? Cost: about 60 s, plus 1–2 minutes for a cold Chromium install. WebGPU specs would be skipped on the runner with a GAP marker, and retries set to 0.
4. **D-4, the wave status table.** Turn it into a kb view over wave `#todo` nodes, or make it orchestrator-only with a pre-commit check?
5. **D-5, where gaps and rules live.** Give `#gap` and `#rule` nodes a parent index, or a home filter, so the first screen isn't about 100 `GAP:` rows?
6. **D-6, opening the store.** Should opening never write unless a real migration (seed or type change) runs, with ranks derived in memory and persisted on the next write?
7. **D-7, single-valued fields.** Add a field-level `cardinality: one`, checked in `txIntegrityError`? This extends wave item (a).
8. **D-8, React in the scene zone.** May `scene/` hold a React hook, or does only the non-React `attachScene` live there?
9. **D-9, first-visit renderer.** Default to 3D on first visit, and give light mode a lab-grade stage treatment?
10. **D-10, mutation coverage.** Widen Stryker to `domain/query` and `operations/map.ts`? The weekly run gets longer.
11. **D-11, the boundary tests.** Replace the three `three-import` boundary tests with one harness rule built from the import graph?
12. **D-12, `index.html`.** Generate the pre-paint script from `lib/theme.ts` and the prefs store at build time?
13. **D-13, the walkthrough.** Delete `kb-code-walkthrough.html`, or regenerate it with a path check?
14. **D-14, option sets as nodes.** Make the design-system and UI-plugin option sets nodes, per "a field's allowed values are nodes", keeping only the selected id per device?
