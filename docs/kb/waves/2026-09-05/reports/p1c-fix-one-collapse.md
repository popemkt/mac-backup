# p1c-fix-one-collapse — one child-order mechanism, honest generator, rule-clause typing

Wave `p1c-fix-one-collapse` of `docs/kb/waves/2026-09-05/plan.md`. Branch
`feature/p1c-fix-one-collapse`, base `main` after p1b (`400d435`). Did not
touch `index/**` or any consumer package. `DatascriptDb` handle on execution
functions kept.

```
560ae07 fix(kb): one child-order mechanism through the query IR
```

`grep -n "rewriteChildOrderCartesian\|dropUnusedFindVars" tools/kb` empty.
`grep -n "child-order" tools/kb/packages/domain/query/src` hits only
`ir/parse.ts` (the collapse) and `index/datoms.ts` (the emit, p1b's).

## 1. One mechanism

`query(edn)` is `executeIr(parseEdn(edn))` then revive-everything.
`runIr(ir)` is `executeIr(ir)` then typed revival. `executeIr` is the one
compile + input-normalisation home: a `%` rules vector is quoted the same
way on both entries.

`rewriteChildOrderCartesian` / `dropUnusedFindVars` are gone. The cartesian
`[?p :node/child ?c] [?p :node/child-order ?ord]` collapses only in
`collapseChildOrder` at parse; compile still projects `:node/children`.

Parser gap closed on the way through: `$` and `%` were not symbol characters,
so every `:in $ …` query (Q4, the cartesian with `?parentId`) fell to
`{ kind: "raw" }` and skipped the collapse. They parse as structured IR now.

## 2. Three red cases

### Last-clause cartesian through `query()`

p1b's greedy-capture case. Parent `p` with children `[c1, c2, c3]`:

```
[:find ?id ?i :where [?p :node/id "p"] [?p :node/child ?c] [?c :node/id ?id] [?p :node/child-order ?i]]
```

The regex path captured `?i]]` when the order clause was last and emitted
unbalanced EDN (`DatalogError: Unexpected EOF`). Through `parseEdn`:
`find` drops unbound `?i` (`[{ kind: "var", name: "id", type: "node-ref" }]`).
`query()` returns `[["c1"], ["c2"], ["c3"]]`. The original 3-children-not-9
case still passes through `query()` (same collapse, `:in $ ?parentId` now
parses).

### `has-tag` / `subtag` through `runIr`

```
[:find ?n :in $ % ?tagId :where [?tag :node/id ?tagId] (has-tag ?n ?tag)]
```

`?n` is bound only by the rule call. Before: `collectNodeRefVars` ignored
`kind: "rule"`, so `?n` was `scalar` and `runIr` returned raw eids. After:
rule-call args are `node-ref` unless bound as a non-ref pattern value.
`ir.find` is `[{ kind: "var", name: "n", type: "node-ref" }]`.
`runIr(..., RULES_SUBTAG, "tag-root")` returns `[["n-direct"], ["n-tagged"]]`.

A rule arg bound as `:node/text` stays `scalar`.

### `runIr` input normalisation

Same Q4 + un-normalised `RULES_SUBTAG` as the `query()` rules red case.
Before: `runIr` passed `%` through raw and DataScript compared keywords to
strings. After: `executeIr` maps every input through `normalizeQueryInput`.
`runIr(..., RULES_SUBTAG, "tag-root")` returns `[["n-tagged"], ["n-direct"]]`.

## 3. Generator shape

Not four `fc.constantFrom` strings. A record over `Clause` / `FindPos`:

| flag | effect on `where` |
|---|---|
| `idLiteral` | `[?n :node/id ?id]` or a fixture id (`n.todo` / `p` / `a`) |
| `text` | omit, `[?n :node/text ?text]`, or a fixture string |
| `typeJoin` | `[?n :f/sys.f.type ?t] [?t :node/id ?tid]` |
| `mentionsJoin` | `[?n :node/mentions ?m] [?m :node/id ?mid]` |
| `children` | optional: parent `p` projected through `children`, `[?c :node/id ?cid]` |
| `reach` | one `:node/mentions` reach from `"a"` |

Find is 1–2 vars sampled from the bound set. Property:
`compile(parseEdn(compile(ir)))` vs `query(edn)` (plus compiled `%` when
`reach` is on) on an 8-node fixture, 50 runs. The nine stored-query fixtures
stay exact cases in the sibling describe.

Compile still quotes keywords, so `parseEdn(compile(ir).query)` of a
pattern-only IR is often `{ kind: "raw" }`; children compile to an
`identity` predicate the subset does not parse. The property is row
equivalence, not structural IR equality.

## 4. What the `run(ir)` wave still needs

- **`KbIndex.run(ir)`** — `runIr` is the composition; the port does not yet
  expose it. Wire it, then switch operations / MCP / CLI / render off
  `query()` so count-revival stays typed.
- **Stored-form migration** — `sys.f.query`, `sys.f.targetQuery`,
  `.kb/queries/*.edn`, `.kb/views/*.json` `query` already parse. Do not
  migrate `sys.f.view.filter` (map EDN, already `raw`).
- **Compile output is not a parseable subset.** Quoted attrs and the
  children `identity` form fall to `raw`. Fine while `run(ir)` takes IR
  directly; do not feed `compile(ir).query` back through `parseEdn` and
  expect structured IR.
- **`returnPath` on `reach`** still ignored by the DataScript compiler.
- **`:node/child-order` datoms** still emitted (`index/datoms.ts`). Execution
  no longer joins them; stopping the emit is the index owner's call.
- Rule-call args are conservatively `node-ref`. A later engine can replace
  that with per-rule signatures; do not add a second typing path beside
  `collectNodeRefVars`.
