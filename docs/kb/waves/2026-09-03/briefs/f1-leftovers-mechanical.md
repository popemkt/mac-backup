# f1-leftovers-mechanical — the last mechanical sites, plus one real bug

Follow-up wave after `b4`/`b5`/`b6` merged into `kb-wave/2026-09-03`.
Harness: cursor. Branch from the current head of `kb-wave/2026-09-03`.
Runs in parallel with `f2` (claude), which owns `packages/ext-sdk`,
`packages/runtime/src/registry.ts`, `packages/operations/src/extension-loader.ts`,
the tsconfig presets and `packages/harness`; **do not touch those**.

Read first: `CLAUDE.md` Rule 1 and "Drift markers and gaps",
`tools/kb/DESIGN.md` "Ratchet scope", `reports/b4-tighten-ui-src.md` §5 and
`reports/b6-tighten-backend.md` §7 (the sites below come from there). Run
`intent/gate.sh session cursor` first.

## Targets (owner-decided; do exactly these)

1. **`ActionReceipt` gets a schema.** `packages/contracts`: declare
   `ActionReceiptSchema` beside its neighbours (they are already `Schema`),
   derive the TS type from it, and decode in `packages/ui/src/api/action.ts`
   (was `json as ActionReceipt`). One schema, one home; nothing re-declared.
2. **`caretRangeFromPoint` bug.** `packages/ui/src/lib/caret.ts` reads
   `document.caretRangeFromPoint` and calls it unbound, so Chrome throws
   `Illegal invocation` and `offsetFromPoint` swallows it into `null`. Call
   it bound (`document.caretRangeFromPoint(x, y)` or `.call(document, …)`).
   Then re-try removing the `document as unknown as CaretDocument` cast the
   way b4 §5a describes; if `lib.dom`'s `@deprecated` on `caretRangeFromPoint`
   still forces a cast, keep exactly one cast with a comment and a
   `// GAP [[<gap-node-id>]]` marker (create the `#gap` node via
   `bun tools/kb/packages/cli/src/main.ts add … --tag gap`).
   Add a test that a bound call is made (a fake `document` whose
   `caretRangeFromPoint` asserts `this === document`).
3. **Legacy localStorage migration ends.** `packages/ui/src/…/graph-view.ts`
   `LEGACY_COLLAPSED_STORAGE_KEY` / `LEGACY_EXPANDED_QUERIES_STORAGE_KEY`:
   delete the one-way migration and the two deprecated constants. Owner
   accepts losing pre-migration collapsed/expanded state. Close gap node
   `01M1MGT2A6Y9ZVG5J1CGJMJ2AH` (status done, note the commit) via the kb CLI.
4. **`@kb/mcp` stays on `Server`.** The SDK deprecates `Server` for
   `McpServer`; kb's registry-built tool list is the "advanced use case" the
   SDK itself names. Two sites (`mcp/src/mcp.ts` ~209, ~281): pinpoint
   `// eslint-disable-next-line typescript/no-deprecated -- registry-built tool list; McpServer cannot express it (SDK docs)`.
   Two-mechanism rule: this makes the advisory count 0 for mcp.
5. **Harness test condition.** `packages/harness/tests/boundaries-oxlint.test.ts:33`
   `no-unnecessary-condition`: delete the impossible branch or fix the
   fixture type. (Only this one file in harness; `f2` owns the rest.)
6. **Two vendor typings in ui.** `force3d-instance.ts:55` and
   `force3d-graph.tsx:209` (b4 §5a): if a `.d.ts` module augmentation of
   `3d-force-graph` in `packages/ui/src/types/` removes the assertion
   soundly, do it once; otherwise leave both with a `// GAP [[id]]` marker and
   one `#gap` node naming the upstream typing issue.

## Rules

- No rule severity changes, no `.oxlintrc.json` edits, no hand edits to
  `lint-warn-baseline.json` — `bun run harness:snapshot` after fixes.
- Behaviour changes allowed: exactly items 2 and 3. Everything else
  behaviour-neutral.
- `bun run verify` green per commit; `bun run test:ui` and `bun test packages`
  green. Commit style `fix(kb-ui): …` / `refactor(kb): …`. No push.

## Report

`docs/kb/waves/2026-09-03/reports/f1-leftovers-mechanical.md` committed on
the branch: per-item outcome, gap nodes created/closed (ids), anything left.
