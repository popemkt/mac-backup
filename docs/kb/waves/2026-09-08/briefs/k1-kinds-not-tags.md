# k1-kinds-not-tags — a supertag says what a node is; behaviours are fields, option sets are children

Wave `k1` of `docs/kb/waves/2026-09-08/plan.md`. Harness: claude. Branch
`kb-k1-kinds` from `main` @ `49500c4`. Run `intent/gate.sh session claude`
first. Read the plan's Decision table before anything else — it is the spec;
this brief is the route.

You own: `tools/kb/packages/domain/model/src/{seed,field-type,system-ids}.ts`
and their tests; `tools/kb/packages/app/ui/src/lib/{query-node,contextual-ref,pinned}.ts`,
`lib/types.ts` (`SYSTEM_IDS`), `actions/mutations.ts`, `lib/run-command.ts`,
`components/outline/node-command-palette.tsx`, the sidebar's Pinned section
and whatever they pull along; `tools/kb/packages/extension/ext-check/src/model.ts`
(the one place that finds enforcement levels by tag); the data migration of
`.kb/nodes.jsonl`; one new section in `tools/kb/DESIGN.md`; one `#rule` node;
regenerated `docs/kb/*.md`; your report. Manifests and `bun.lock` are yours if
a package needs a dep it lacks. You do not touch `harness/src/constraints.ts`,
`.oxlintrc.json`, or `lint-warn-baseline.json` (use `bun run harness:snapshot`
if a count moves and say why).

Read first: `tools/kb/DESIGN.md` → "Data model — everything is a node" (the
`targetTag`/`targetQuery` paragraph at ~410–430) and "Ontologies";
`tools/kb/DESIGN-UI.md` → "Contextual references (i12)"; `field-type.ts`
(`targetTagsOf`, `targetQueryOf`, `allowedRefIdsOf`); `seed.ts` end to end;
`pinned.ts` header comment (it argues for the tag — you are overturning it,
so answer it); `ext-check/src/model.ts:100–160`; `tools/kb/AGENTS.md`.

## Why

Six supertags in the tree name no concept. `#ref` and `#query` mark a
behaviour a field already carries, so the same distinction is read from two
carriers (`contextual-ref.ts` checks the tag *and* reads the target;
`query-node.ts` checks the tag by *name*). `#enforcement-level`,
`#check-surface` and `#field-type` exist only because `targetTag` was the one
way to say "these nodes are the options" — so five value nodes wear two
supertags each and float with no parent. `#pinned` is sidebar membership
wearing a tag. The owner wants Tana's shape: options are just nodes, tags are
for things. Rule 1 wants one carrier per distinction. Same fix.

## Shape

### 1. Options are children (`field-type.ts`, `seed.ts`)

`allowedRefIdsOf` derives **one** EDN query from what the field declares, in
this precedence, exactly one applying:

1. `sys.f.targetQuery` — the general form, unchanged.
2. `sys.f.targetTag` — union of tag instances, unchanged. Still legitimate
   for fields whose options *are* things (`sys.f.onto.include` → every
   supertag; `rule.check` → `#check` nodes).
3. **the field node's own children** — when it declares neither and has
   children, the allowed ids are its children. No new field, no new prop:
   the parent–child datom is the declaration.

Express 3 as an EDN string built the way `ONTOLOGY_TARGET_QUERY` is, run
through the same injected runner, so the resolver stays "derive query, run
query". Do not add a fourth branch that walks `children` in TS beside the
query path — that is the second `if` Rule 1 forbids.

Seed changes:

- `sys.ft.*` become children of `sys.f.fieldType`; `#field-type`
  (`SYSTEM_IDS.fieldTypeTag`) and its `targetTag` declaration go. Keep the
  `sys.ft.*` ids — code compares against them.
- `sys.tag.ref` and `sys.tag.query` go. `sys.f.ref.target` and `sys.f.query`
  stay, templated by nothing. Check whether any seeded tag lists them in
  `sys.f.fields` and remove that.
- A seeded `sys.pinned` node ("Pinned") whose children are contextual
  references. No tag.

### 2. Kinds by field (`query-node.ts`, `contextual-ref.ts`, mutations)

- `isQueryNode(node)` ⇔ `sys.f.query` prop present. Delete `isQueryTagBadges`
  and the "any tag named query" acceptance — that was reading display back as
  truth, the anti-pattern `pinned.ts` already names.
- `contextualTargetOf(node)` ⇔ `sys.f.ref.target` present and a ref. Delete
  `hasRefTag`.
- *Turn into query* / *Turn into reference…* set the field and nothing else.
  Undo still works because it is `node.update` either way. The empty-EDN
  state for a fresh query node: pick what today's tag-templated empty slot
  gave the user (a visible, editable `sys.f.query` row) and make the field
  set achieve the same — do not lose the editing affordance. If `sys.*`
  hiding is in the way, the same debug-fields per-row switch `#query` already
  relied on is the answer, not a new visibility rule.
- Datalog anywhere that filtered on `sys.tag.query` / `sys.tag.ref`
  (`grep -rn "sys.tag.query\|sys.tag.ref\|refTag\|queryTag"` over
  `packages/`) swaps to the field datom `[?n :f/sys.f.query _]` etc.

### 3. Pinned is a list of references (`pinned.ts`, sidebar)

The sidebar's Pinned section renders the children of `sys.pinned`, each a
contextual reference (`sys.f.ref.target`) to the pinned node, in child order.
Pin = add such a child; unpin = remove it. Rewrite `pinned.ts` around that;
its header comment must now explain why a list of references beats a tag
(order for free, one node kind reused, Tana-faithful). Reorder by drag comes
free if the outline already reorders children; if it does not reach the
sidebar, say so, do not build it.

### 4. ext-check reads the field's children (`ext-check/src/model.ts`)

Enforcement levels = children of the `enforcement` field node; surfaces =
those minus the one whose text is `prose`. Set `surface`'s `targetQuery` to
express exactly that (children of `enforcement` where text ≠ "prose") — a
query, not a hand list. Nothing in `SURFACE_FILES` or the audit kinds
changes. `check:audit` must be clean at the end.

### 5. Data migration (`.kb/nodes.jsonl`)

Never hand-edit. Write it as CLI/action invocations in a script you commit
under `docs/kb/waves/2026-09-08/reports/k1-migration.sh` (so the coordinator
can re-run it on a rebased tree) using
`bun tools/kb/packages/app/cli/src/main.ts …` — `--force` is allowed for the
`sys.*` nodes this wave retires. Steps: reparent the six enforcement values
under field `enforcement` (`01M1M01PMXYSBVR4WARCA9GH12`); drop their
`enforcement-level` / `check-surface` type refs; delete tags
`enforcement-level` (`01M1M028WWE79KKKEC9Z4P48ZK`) and `check-surface`;
strip `sys.tag.ref` / `sys.tag.query` type refs from every node carrying
them; turn any node tagged `pinned` into a reference child of `sys.pinned`
and delete the `pinned` tag; set `surface`'s (`01M1TAKRTZ4YK5E39S8QB0226R`)
`targetQuery`. Hard rules: a node the migration does not name is
byte-identical; every ref prop that pointed at a retired tag is gone, none
dangles; `kb checks`/`check:audit`/`docs.check` clean after.

If a load-time migration in the style of `migrateFieldTypeValues` is the
cleaner home for the type-ref stripping (so a stale `.kb` on another machine
heals itself), do that *and* keep the script for the reparent/targetQuery
steps — but then the load-time rule must have a test, and DESIGN.md must
say the migration is one-shot and will be deleted after the next wave.

### 6. Docs and rule

- `tools/kb/DESIGN.md`, new subsection under the data model:
  **"Kinds, roles and options"** — the Decision paragraph from the plan, the
  strip test, the three-way `allowedRefIdsOf` precedence, and a sentence on
  why `#ontology`/`#rule`/`#gap`/`#check` remain tags. Update the
  `targetTag`/`targetQuery` paragraph to mention children. Update the
  contextual-reference bullet (no more `#ref`). Fix the "(i12)" label in
  DESIGN-UI — contextual refs landed in `e6dca65`, not wave i12; say "(2026-08-27)".
- One `#rule` node: `home` = `tools/kb/DESIGN.md#kinds-roles-and-options`,
  `scope` = kb, `principle` = the one-line decision, `enforcement` honest.
  If you can give it a real `check` — e.g. a `@kb/model` test asserting that
  no seeded `sys.tag.*` templates zero fields and is referenced by no field's
  `targetTag` (a tag that names no fields and gates no picker is a marker,
  not a thing) — mint the `#check`, wire it, and let `ext.check.sync` derive
  `harness`. If that test is not honest, leave `enforcement` as `prose` and
  say why in the report. Do not fake a check.

## Commits

1. `refactor(kb): ref-field options may be the field node's children` —
   resolver + seed for `sys.ft.*`, tests, DESIGN.md paragraph. Behaviour
   for every existing field unchanged (they all declare `targetTag` or
   `targetQuery`).
2. `refactor(kb): query and reference are fields, not tags` — kinds by field
   presence, seeds for `sys.tag.{ref,query}` removed, palette gestures,
   datalog swaps, tests.
3. `refactor(kb): Pinned is a list of references` — `pinned.ts`, sidebar,
   seed `sys.pinned`.
4. `refactor(kb): enforcement levels and check surfaces are field children` —
   ext-check model + `surface` targetQuery.
5. `chore(kb): migrate .kb to kinds-not-tags` — script, data, regenerated
   docs, `#rule` node (+ `#check` if honest).

Gates before every commit: `bun run verify` in `tools/kb` (this already runs
harness, check:audit, docs.check). Commits take minutes on the pre-commit
hook — run them in the background and wait.

## Ownership questions

Do not stop on these; the answers are here. Manifests and `bun.lock`: yes.
`sys.*` seeds and ids: yes, that is the wave. Deleting `SYSTEM_IDS.refTag`,
`queryTag`, `fieldTypeTag`: yes. Anything else: make the smallest call
consistent with the Decision table, record it in the report under
"Calls I made", continue. If you use `orca orchestration ask`, keep working
on the parts that do not depend on the answer.

## Report

`docs/kb/waves/2026-09-08/reports/k1.md`: the resolver precedence as
implemented; per retired tag, what replaced it and the grep proving no
reader remains; the migration script and a before/after count of type refs
to retired tags (must end at 0) plus proof of byte-identity for untouched
nodes (a diff line count, or a `canonicalJsonl` comparison); how the
query-node empty state is edited now; whether the `#rule` got a real
`check`; verify / test output; "Calls I made"; gaps filed.
