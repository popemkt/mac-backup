# w1-run-ir-one-store — `run(ir)`, one store interface

## Commits

- `1e48855 feat(kb): KbIndex.run(ir)`
- `refactor(kb): one store interface` (this report travels with the commit)

## Query port

`KbIndex` now owns both query surfaces:

```ts
runDatalog(edn: string, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>>
run(ir: Ir, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>>
```

`DatascriptIndex.run` compiles through `runIr`, executes against its private
DataScript database, and revives only IR positions typed as `node-ref`.
`runDatalog` remains the raw EDN surface for MCP, CLI, WebSocket, and the two
string consumers that migrate in later waves.

The domain package exports `LIST_FIELDS_IR`, `LIST_TAGS_IR`,
`LIST_ALL_NODES_IR`, and `BACKLINKS_IR`. `BACKLINKS_IR` binds the target id as
an `:in` value, so ids containing `"` never enter query text. The existing EDN
exports remain for `application/operations/src/map.ts` and the current UI data
layer. `extractMentions` is now exported from the `@kb/query` barrel.

Deleted query symbol:

- public `DatascriptIndex.handle`

The required red cases pass through the port: an aggregate count equal to a
live eid remains the number `3`, while a backlinks query accepts a target id
containing `"` and returns the referencing node.

All currently requested structured consumers are expressible by `run(ir)`.
Arbitrary user-authored EDN intentionally remains on `runDatalog`; the known
general IR limitation is unchanged: `reach.returnPath` is not implemented by
the DataScript compiler.

## One persistence interface

`KbContext` now has one persistence field:

```ts
store: EffectStore
```

`JsonlStore` implements only `EffectStore`. Async tests and legacy Promise
application edges run `loadEffect` and `commitEffect` with `Effect.runPromise`
at their boundary.

Deleted persistence symbols:

- `Store`
- `asPromiseStore`
- `KbContext.effectStore`
- `JsonlStore.load`
- `JsonlStore.commit`

No extension handlers required conversion: the ownership audit found no live
`ctx.store.commit(...)` or other Promise-store reader in `ext-canvas` or the
remaining extensions. Gap `01M1PJVW0VZ283V1N3PDXFSHTC` is now `status=done`,
updated through the Bun kb CLI.

## Verification

- `bun run verify`
- `bun test packages`
- `bun run test:ui`
- acceptance search has no `asPromiseStore`, `interface Store`, or non-UI
  `.handle` occurrence under `tools/kb/packages`
