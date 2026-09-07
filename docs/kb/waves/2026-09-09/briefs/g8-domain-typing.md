# g8-domain-typing — node-backed configs decode through one Schema each; `order` is declared, not optional

Wave `g8` (batch 2) of `docs/kb/waves/2026-09-09/plan.md`. Harness: claude.
Branch `kb-g8-domain-typing` from **`kb-merge-origin`** (batch 1 merged). Run
`intent/gate.sh session claude` first. Read each gap node
(`bun tools/kb/packages/app/cli/src/main.ts get <id>`), then
`tools/kb/DESIGN.md` → domain typing section (it already says these configs
should decode through Effect Schema — you are making the doc true),
`packages/domain/model/src/node-schema.ts` (`KbNodeSchema`,
`decodeStoredNode`, `nodeParseOptions` — the one Schema that exists; follow
its posture: correlated unions, preserve unknown keys, sync decode wrapped by
the caller), `ui/src/lib/graph-lens.ts` (`parsePerspective`; g1 changed how
source values are read — read g1's report first), `ui/src/lib/view-config.ts`
(`getViewConfig`), and `packages/domain/model/src/order.ts` +
`canonical.ts` (the byte-exact round-trip tests that must stay green).

You own: `ui/src/lib/graph-lens.ts`, `ui/src/lib/view-config.ts`, a new
schema module beside each (or one `ui/src/lib/node-config-schema.ts` if the
two share a decoder — one mechanism), their tests;
`packages/domain/model/src/{node-schema,order,model}.ts` and tests for the
`order` gap; DESIGN.md's domain-typing prose. **Not yours**: components,
stores, `constraints.ts`, `.oxlintrc.json`, the baseline except via snapshot
when a count drops.

## Gaps

1. `01M1MGCEBYDFRNJX1JKXXN825H` — `parsePerspective` decodes a
   `#graph-perspective` node with 27 hand-written branches. **Not
   mechanical**: a Schema changes what happens on malformed input (today each
   field degrades silently to its default). Decide the policy and state it in
   DESIGN.md: recommended — decode per field with a declared default so one
   bad prop falls back *and is reported* (a `warnings: string[]` on the
   result, surfaced the way the ontology resolver surfaces its warnings), not
   silently and not by failing the whole perspective. The user's stored
   perspectives (`lens.all-mentions` still holds pre-node `{t:"str"}`
   values, per g1) must decode identically — characterize with the live
   store's node before you touch anything.
2. `01M1MGCJAKKST0C1R54VVX9HPX` — `getViewConfig` decodes view props with 45
   branches. Same Schema mechanism, same policy, second instance. Defaults
   are stated once (in the Schema), not in the ontology *and* the function —
   check whether the seed declares defaults for `sys.f.view.*` fields and, if
   it does, make the Schema read them or delete them from the seed; two
   homes is the mirror Rule 1 forbids.
3. `01M1M08XNE3SBGY1MMNA1A73VX` — `KbNode.order` is optional and undeclared.
   `closes`: declare `order` in the schema and encode the migration state as
   a discriminator instead of an optional field, keeping the byte-exact
   round-trip test green. Read `order.ts` to see what "migration state" means
   here (nodes minted before fractional ordering have no `order`; the
   canonical writer must not invent one). The shape: `KbNodeSchema` says
   exactly when `order` is absent, and the code that today asks
   `node.order === undefined` asks the discriminator instead.

## Rules

- **Restructure, then add, as separate commits**: the Schema that reproduces
  today's behaviour byte-for-byte lands first (characterization from the live
  store + fixtures), the reporting policy second.
- The Schema library is `effect`'s `Schema`, already a dependency of
  `@kb/model`; the UI package must be able to import it (check
  `ui-boundaries` and `import-graph` — `lib` may import `@kb/model`; if the
  Schema lives in `@kb/model` the UI reads it from there, which is the
  cleaner home anyway since a perspective node is a domain concept).
- `oxlint-disable-next-line complexity -- GAP [[…]]` on those two functions
  comes off when the gap closes; the replacement must be under the threshold.
- No `.skip`, no new `oxlint-disable`.

## Commits

1. `test(kb): characterize parsePerspective and getViewConfig on stored nodes`
2. `refactor(kb): graph perspective decodes through one Schema`
3. `refactor(kb): view config decodes through the same Schema mechanism`
4. `feat(kb): malformed config props are reported, not swallowed` (policy)
5. `refactor(kb): KbNode.order is declared; its absence is a discriminator`
6. `chore(kb): close domain-typing gaps` — statuses, DESIGN.md, docs.

Gates before each: `bun run verify`, `bun test packages`, `bun run test:ui`.
Background commits.

## Ownership answers

Files above, a Schema module in `@kb/model`: yes. Seed default deletion for
gap 2: yes, if the Schema now owns them and the report says so. A store API
change or a component change: no — report. Anything else: smallest call,
record, continue.

## Report

`docs/kb/waves/2026-09-09/reports/g8.md`: the Schema shapes; the malformed-
input policy and where a warning surfaces; proof the live store's
perspectives decode identically before/after (compare the parsed objects);
how `order`'s absence is now expressed and which call sites changed;
`complexity` count before/after; test output; "Calls I made".
