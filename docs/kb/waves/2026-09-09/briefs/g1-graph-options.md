# g1-graph-options — graph renderer and source options are children, not supertags

Wave `g1` of `docs/kb/waves/2026-09-09/plan.md`. Harness: claude. Branch
`kb-g1-graph-options` from **`kb-merge-origin`** (not `main`). Run
`intent/gate.sh session claude` first. Read `docs/kb/waves/2026-09-08/plan.md`
(the Decision table) and `tools/kb/DESIGN.md` → "Kinds, roles and options"
before anything else — that is the rule this wave applies.

You own: `tools/kb/packages/domain/model/src/{seed,model,graph-schema,index}.ts`
and their tests; `tools/kb/packages/app/ui/src/lib/{graph-lens,graph-bindings}.ts`,
`components/graph/graph-renderers.ts` and whatever else reads the option ids;
a migration script under `docs/kb/waves/2026-09-09/reports/g1-migration.sh`;
the data in both stores (`.kb/nodes.jsonl`, `tools/kb/.kb/nodes.jsonl`) via
the CLI only; one paragraph in DESIGN.md if a rule sharpens; your report.
Do not touch `harness/`, `.oxlintrc.json`, `lint-warn-baseline.json`.

## Why

`bun test packages/domain/model/tests/kinds.test.ts` fails 3 ways on
`kb-merge-origin`: `graph-renderer` and `graph-source` are seeded supertags
that template zero fields, and `lens.renderer` names `graph-renderer` by
`targetTag`. Wave k1 retired that shape (`#field-type`, `#enforcement-level`,
`#check-surface` went the same way) and wrote the fence; the owner's graph
perspective work was pushed from a tree that predates it. Nothing is wrong
with the perspectives — only with how their option sets are declared.

## Shape

Follow k1's two precedents exactly; do not invent a third.

1. **Renderer options are the field's children.** `sys.graph.renderer.*` (five
   nodes) become children of `sys.f.lens.renderer`, in the order
   `GRAPH_RENDERER_VALUES` declares. The field drops its `targetTag`;
   `allowedRefIdsOf` clause 3 (field children) now answers the picker. Tag
   `sys.tag.graph-renderer` is deleted from the seed and `SYSTEM_IDS`.

2. **Source options are one shared list; fields select from it by query.** Ten
   `sys.graph.source.*` nodes are used by five fields (`color-by`,
   `cluster-by`, `size-by`, `label-by`, `edge-kinds`), partitioned by the
   `kind` that today lives only in TS (`GRAPH_SOURCE_VALUES[*].kind`:
   category / number / label / relationship). A node has one parent, so:
   - seed one list node `sys.graph.sources` ("Graph sources", no tag — the
     `pinned` list is the precedent) whose children are the ten options;
   - put `kind` in the data: a seeded field `sys.f.graph.source.kind`
     (`text`, or a ref into a four-child option set on that field — your call,
     say which and why) carried by each option node;
   - each of the five lens fields declares a `targetQuery` over
     `sys.graph.sources`' children filtered by kind, the way `surface`
     selects `enforcement`'s children minus `prose`. Today those five fields
     are **unrestricted** (origin only constrained `renderer`), so this is the
     first time the picker narrows them — say so in the report, and check
     `graph-lens.ts` / `graph-bindings.ts` still resolve a stored value that
     is not in the option set (a `prop:<id>` ref to a user field, per
     `graphSourceKey`) without throwing.
   Tag `sys.tag.graph-source` is deleted from the seed and `SYSTEM_IDS`.

3. `kinds.test.ts` goes green **without being edited**. If you believe a
   clause of it is wrong, stop and say so in the report; do not weaken it.

4. `ensureSystemSeed`'s `adoptSeedChildren` will parent the option nodes on
   the first CLI call against each store (k1 added that pass). Your migration
   script therefore only: unsets the two kind refs on the fifteen option
   nodes, unsets `lens.renderer`'s `targetTag`, sets the five `targetQuery`s,
   sets `kind` on the ten sources, and deletes the two tag nodes — each step
   guarded so a re-run skips out loud (copy the `have`/`retire_tag` idiom from
   `docs/kb/waves/2026-09-08/reports/k1-migration.sh`). `--force` only for
   `sys.*` nodes. Both stores.

5. `graph-schema.ts` keeps `GRAPH_RENDERER_VALUES` / `GRAPH_SOURCE_VALUES` as
   the TS vocabulary the renderer code compiles against; the seed derives the
   nodes from them (it already does). Do not add a second list.

## Commits

1. `refactor(kb): graph renderer and source options are field children` —
   seed, SYSTEM_IDS, tests; `kinds.test.ts` green on a fresh `kb init`.
2. `chore(kb): migrate .kb graph options to kinds-not-tags` — script, both
   stores, regenerated docs.

Gates before each commit, from `tools/kb`: `bun run verify`, `bun test
packages` (all green, including `kinds.test.ts`), `bun run test:ui`. Commit in
the background and wait; the hook takes minutes.

## Ownership answers

Seeds, `SYSTEM_IDS`, both stores, manifests: yes. Everything else: smallest
call consistent with the Decision table, recorded under "Calls I made",
continue. Do not wait on `orca orchestration ask` for more than one part of
the work.

## Report

`docs/kb/waves/2026-09-09/reports/g1.md`: the five `targetQuery`s as stored
and the rows they return on the live store; where `kind` lives and why; the
type-ref count to the two retired tags before/after (must end 0) and the
byte-identity count of untouched nodes; the grep proving no reader of
`graphRendererTag` / `graphSourceTag` remains; test output; "Calls I made";
gaps filed (none expected).
