# f1-leftovers-mechanical — report

Follow-up wave after `b4`/`b5`/`b6` merged into `kb-wave/2026-09-03`.
Harness: cursor. Branch `feature/f1-leftovers-mechanical` on `5813670`.
Did not touch `packages/ext-sdk`, `packages/runtime/src/registry.ts`,
`packages/operations/src/extension-loader.ts`, the tsconfig presets, or
harness except `packages/harness/tests/boundaries-oxlint.test.ts` and a
`bun run harness:snapshot` of the ledger. `.oxlintrc.json` was not edited.

`bun run verify` green before each commit. `bun run test:ui`: **631/631**.
`bun test packages`: **363/363** (DST/benchmark/palette-50k are load-sensitive
and passed on a quiet rerun).

---

## 1. Per-item outcome

| # | Item | Outcome | Commit |
|---|---|---|---|
| 1 | `ActionReceipt` schema | **done.** `ActionReceiptSchema` lives in `packages/contracts/src/actions.ts` beside the type, derived with `z.infer`, reusing `FailureCodeSchema`. UI `api/action.ts` `safeParse`s it; the `json as ActionReceipt` assertion is gone. | `a25b133` |
| 2 | `caretRangeFromPoint` bound call | **done, with one remaining cast.** Bound method call (`doc.caretRangeFromPoint(x, y)`). Direct `document.caretRangeFromPoint` is `typescript/no-deprecated` and would raise the advisory ratchet, so the `CaretDocument` probe stays as the one cast. Gap `01M1P2R0XMSK1MRVQ8P2JH5V0Z`. Test asserts `this === document`. | `2e6c2b4` |
| 3 | Legacy localStorage migration | **done.** `LEGACY_*` constants and the one-way `loadExpandedIds` migration deleted. Gap `01M1MGT2A6Y9ZVG5J1CGJMJ2AH` closed (`status=done`, child note names `ec796ed`). Pre-migration `kb-ui:collapsed` / `kb-ui:expanded-queries` state is stranded by owner decision. | `ec796ed` |
| 4 | `@kb/mcp` stays on `Server` | **done.** Pinpoint `eslint-disable-next-line typescript/no-deprecated` at the `createMcpServer` return type and `new Server(...)`. Advisory count for mcp is 0. | `1a5c9fd` |
| 5 | Harness `no-unnecessary-condition` | **done.** `o.rules` is required on `OxlintOverride`; dropped the impossible `?.`. Workspace count reached 0. Not promoted (brief forbade `.oxlintrc.json`). | `0d599f1` |
| 6 | Two vendor typings in ui | **left as GAP.** `3d-force-graph` publishes a non-generic `const` constructor; `IForceGraph3D` is unexported and `ForceGraph3DInstance` is a type alias, so a `packages/ui/src/types/` module augmentation cannot restate either signature soundly. Both assertions kept with one gap `01M1P2RAJVTB4CESYGEVF7NDE1`. | `a255c7b` |

## 2. Gap nodes created / closed

| Id | Fate |
|---|---|
| `01M1MGT2A6Y9ZVG5J1CGJMJ2AH` | **closed.** `status=done`. Child `01M1P3JXF5SFJC1RRH9HTR6YT2` notes `ec796ed`. |
| `01M1P2R0XMSK1MRVQ8P2JH5V0Z` | **created.** caret `CaretDocument` cast forced by lib.dom `@deprecated`. |
| `01M1P2RAJVTB4CESYGEVF7NDE1` | **created.** 3d-force-graph constructor + `nodeThreeObject` typings. |

## 3. Behaviour changes

Allowed by the brief, and only these two:

1. **`offsetFromPoint` now calls `caretRangeFromPoint` bound.** Chrome no longer throws `Illegal invocation` into the `null` fallback; click-to-caret on outline text uses the vendor probe.
2. **`loadExpandedIds` reads only `kb-expanded`.** Keys `kb-ui:collapsed` and `kb-ui:expanded-queries` are ignored. Cold-start expansion state that never migrated is lost.

Everything else is behaviour-neutral. Malformed `/api/action` JSON that used to pass a status check and get asserted now fails schema decode and becomes `{status: "failed", code: "internal"}` — that is the schema doing its job at the wire boundary, not a product behaviour change.

## 4. Ledger (after `bun run harness:snapshot`)

| Lane | rule | count |
|---|---|---:|
| blocking | `effect/anyUnknownInErrorContext` | 1 |
| blocking | `effect/globalConsole` | 1 |
| blocking | `eslint/max-lines` | 2 |
| blocking | `eslint/max-lines-per-function` | 40 |
| blocking | `typescript/no-unsafe-type-assertion` | 7 |
| advisory | `typescript/no-deprecated` | 3 |

`typescript/no-unnecessary-condition` reached 0 and left the ledger. Promotion to `error` in `.oxlintrc.json` is the coordinator's. Advisory `typescript/no-deprecated` is the three `cursorPosition` sites (gap `01M1MGT307N4K243CBPJTXNG5X`, outside this wave).

`no-unsafe-type-assertion` 8 → 7: the `api/action.ts` assertion is gone. The remaining 7 are caret (1), force3d (2), plus the four backend sites `f2` owns.

## 5. What is left

- Promote `typescript/no-unnecessary-condition` to `error` (coordinator; `.oxlintrc.json`).
- `cursorPosition` still deprecated (3 hits); canvas caret migration, not this wave.
- Two 3d-force-graph assertions until upstream exports a generic constructor and types `nodeThreeObject` as Object3D \| falsy (`01M1P2RAJVTB4CESYGEVF7NDE1`).
- One `CaretDocument` cast until lib.dom drops `@deprecated` on `caretRangeFromPoint` (`01M1P2R0XMSK1MRVQ8P2JH5V0Z`).
- `f2` still owns the Effect promotion leftover in registry / extension-loader / ext-sdk / tsconfig presets.
