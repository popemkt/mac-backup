# kb: one SDK per side (E15+)

Plan of 2026-10-04, a follow-on to the
[extension-boundaries plan](README.md) (E0–E14). It answers the owner's
ask: "keep core clean from extensions. maybe start making packages/lib for
extension now?" The contract it builds on is
[DESIGN.md → Extension families](../../../tools/kb/DESIGN.md#extension-families);
where they differ, that section wins. Measurements are from `main` at
`d818dc03`, before E9b, E13 and E14 land.

**In one paragraph.** Core already never imports an extension, except
through the four composition roots and two named breach lists. The
browser side has its SDK, `@kb/ui-sdk`. The shared and server side does
not need a new package, because its SDK already exists: it is the
`contract` layer, read together with the `domain` vocabulary. A façade
package is forbidden by the barrel rule. Moving the extension contract out
of `@kb/contracts` would create an import cycle. And core's own plugin
builds on that same contract. What is actually wrong is narrower, and
this plan fixes three things:
- extensions may reach core's use cases (`application`), and three of them
  do;
- a few helpers are copied between families, because the family fence
  leaves them no shared home;
- the repository-extension surface, `kb-ext-sdk`, is a mirror that is
  checked against the contract on only two of its types.

The fence then reads: an extension builds on `domain`, `contract`, `kit`
and its own family, and on nothing else.

## 1. What core is, and whether it names an extension

**Core is every package outside `packages/extension/`.**

| Layer | Packages |
|---|---|
| domain | `model`, `plugin`, `query`, `views` |
| contract | `contracts`, `sandbox`, `ext-sdk` |
| application | `operations` |
| infrastructure | `store-jsonl`, `store-sqlite`, `tx-log`, `workspace-fs`, `sandbox-quickjs`, `sandbox-worker` |
| kit | `ui-sdk`, `scene`, `scene-gpu` |
| app | `bundled`, `runtime`, `cli`, `server`, `client`, `mcp`, `webmcp`, `ui`, `test-kit` |
| test-support | `render-tests` |

**The invariant.** Core never imports an extension package. Only these
four composition-root files may name one, and none of them may re-export
it:
- `runtime/src/bundled.ts`;
- `cli/src/host-plugins.ts`;
- `ui/src/ui-plugins.ts`;
- `bundled/src/index.ts`.

**What enforces it today.**

| Direction | Mechanism | State on main |
|---|---|---|
| domain, contract, application, infrastructure, kit → extension | `LAYER_ALLOWS` has no `extension` in these rows | **holds**: zero imports, in production code and in tests |
| app → extension | `EXTENSION_ROOTS`, the root fence | holds, apart from the breaches below |
| tests → extension | test files are exempt; domain tests reach every family's shared package through `@kb/bundled` (`TEST_WORLD_PACKAGES`) | sanctioned as the test world; not a breach |

**The exact breaches** (every row of `EXTENSION_ROOT_BREACHES`):

| File(s) | Imports | Leaves with |
|---|---|---|
| `ui/src/components/canvas/*` (55 files) and `ui/src/catalog/canvas-card.stories.tsx` | `@kb/canvas` | E13 |
| `cli/src/bin/check-audit.ts` | `@kb/ext-check` (`auditOutput`) | **no step yet**; see E18 |
| `cli/src/bin/docs-check.ts`, `cli/src/bin/docs-materialize.ts` | `@kb/ext-docs` (`checkOutput`, `materializeOutput`) | **no step yet**; see E18 |

**Core still names features without importing them.** The import fence
cannot see these, and the rule node "Core names no feature" lists them
as not checked yet:
- canvas ids and keys in `@kb/model` and `@kb/views`, which E9b moves
  (GAP `01M39F3MR3HT2NR553FY8CRD6X`);
- **the screen protocol names the canvas**: `PaneScreen.canvas`,
  `CanvasScreenSchema` and `CANVAS_VIEW_PRESET_NAMES` in
  `contracts/src/screen.ts`, and `ui.capture` ("Capture a canvas") in
  `operations/src/ui.ts`. No step and no gap covers this yet:
  `GAP [screen-protocol-names-canvas]`.

## 2. The SDK for the shared and server half

### Recommendation: no new package; the contract layer is the SDK

**A new package cannot be built cleanly, for three reasons.**
1. **A façade is forbidden.** `public-surface` refuses a barrel that
   re-exports another package's symbols ("a second name for someone else's
   surface"). So an `@kb/sdk` cannot forward `KbNode` or `defineExtension`.
   It would have to own them.
2. **Owning them creates a cycle.** In `contracts/src/actions.ts`,
   `ActionHandlerEnv` names `ExtensionCatalog`, `ViewCatalog` and
   `TemplateRegistry`. In turn, `extension.ts` needs `ActionDefinition`
   from `actions.ts`. So the extension contract and the action contract
   are one contract. Splitting them means moving `actions.ts`, and with it
   `approval`, `channel`, `mcp-tool` and `protocol`, which is most of
   `@kb/contracts`.
3. **Core builds on the same contract.** `corePlugin` contributes to
   `ActionPoint`, and `coreExtension` is a `defineExtension`. There is one
   kernel, so there is one plugin contract. An SDK for extensions only
   would be a second plugin contract: the `fooV2` that Rule 1 forbids.

**Why the browser side is different.** `@kb/ui-sdk` was carved out of an
`app` package, the shell's `lib`, `primitives` and `ds`. On the server
side the host API never lived in `app`; it is already in `contract`. So
the symmetric statement is this: **each side's SDK is the layer below the
composition roots that holds that side's host API.** That layer is
`contract` (with the `domain` vocabulary) for the shared and server half,
and `kit` for the browser. The `lib` the owner asked for already exists
as these two layers, so no third one is added.

### What the SDK is, derived from what extensions import today

These are all the production `@kb/*` imports made by
`packages/extension/*/src`, apart from same-family imports and `kit`
imports. The verdicts are: **stays** (the import is already SDK),
**port** (it leaves `application` for a contract service), and
**moves** (the code changes home).

| Source (layer) | Symbols | Used by | Verdict |
|---|---|---|---|
| `@kb/model` (domain) | `SYSTEM_IDS`, `KbNode`, `NodeId`, `PropValue`, `QueryNodeDef`, `DomainError`, `domainError`, `ResolveError`, `domainFromResolve`, `resolveFieldId`, `isSysPrefixed`, `currentIso`, `freshId`, `canonicalJson`, `firstRef`, `firstStr`, `queryDefOf`, `seededField` | chart, chart-ui, chart-vega, code, code-ui, ext-canvas, ext-check, ext-docs | stays |
| `@kb/plugin` (domain) | `definePlugin`, `Plugin` | agent, agent-ui, chart, chart-ui, chart-vega, code, code-ui, lab, lab-ui | stays |
| `@kb/query` (domain) | `queryRecords`, `QueryRecords` | chart | stays |
| `@kb/views` (domain) | `viewKey`, `encodeLensConfig`, `ConfigReport`, `issueText`, `paramsIssues`, `viewNodeFor` | chart, chart-ui, code, lab | stays |
| `@kb/contracts`: the extension contract | `defineExtension`, `declarationPlugin`, `viewDef`, `ViewDef`, `ViewText`, `extensionPlugin`, `ExtensionAction`, `ExtensionTemplate`, `TemplateContext`, `TemplateRegistry`, `SavedQueries`, `KbContext` | every family | stays |
| `@kb/contracts`: services | `KbCtx`, `Screens`, `ReadInvoke`; `KbStore` (a type, in ext-canvas) | code, ext-canvas, ext-check, ext-docs | stays; `KbStore` leaves ext-canvas once its writes go through the port |
| `@kb/contracts`: action results | `failed`, `asObjectSchema`, `ActionReceipt`, `ActionReceiptSchema`, `ActionInvocation`, `ManifestEntry` | agent, agent-claude, agent-ui, code-ui | stays |
| `@kb/contracts`: wire, approval, MCP | `onWire`, `listingOf`, `SurfaceWire`, `ChannelPoint`, `Channel`, `ChannelPeer`, `UiHost`, `UiHostService`, `ScreenListSchema`, `TabScreen`, `WireNode`, `mcpToolHints`, `mcpToolName`, `mcpToolResult` | agent, agent-claude, agent-ui, lab-ui | stays: the agent is a host extension, and the wire is its API |
| `@kb/sandbox` (contract) | `UntrustedEngine`, `snapshotRun`, `CodeGrant`, `ENGINE_LIMITS`, `SANDBOX_FRAME_PATH`, `SANDBOX_IFRAME_FLAGS`, `codeDigest`, `engineKindFor`, `EngineKind`, `RunStatus` | code, code-ui | stays |
| `@kb/operations` (application) | `persistEffect` | ext-canvas `write.ts`, ext-check `sync.ts` | **port**: `GraphWrites.commit(tx)` |
| | `planNodeAddEffect` | ext-canvas `verbs.ts` | **port**: `GraphWrites.planNodeAdd(input)` |
| | `docsViewsEffect`, `docsViewEffect`, `renderViewEffect`, `DocsError` | ext-docs `index.ts` | **port**: core's `render.views` and `render.view {name}` through `ReadInvoke`, which `kbRuntimeLayer` already binds |
| | `renderText` | ext-docs `rules.ts`, `todos.ts` | **moves** to `contracts/src/template.ts`, beside `TemplateContext`. Its own comment says it is "offered to template authors", and it is pure |

The browser halves add only `kit`: `@kb/ui-sdk` (7, 22, 17 and 44
symbols in agent-ui, chart-ui, code-ui and lab-ui) and the scene kit (30
symbols, all in lab-ui). These are unchanged.

**Helpers copied between families move to their owner.** These copies
are the shared code the owner's "lib" was reaching for:

| Copies | Where | Home |
|---|---|---|
| `propText`, `tagIdsNamed` (read a node's field and a tag by name) | `ext-check/src/model.ts`, `ext-docs/src/rules.ts` | `@kb/model`, beside `resolveFieldId`, but only if E16 finds them to be one rule. The docs copy renders mentions and the check copy does not |
| `cell` (escape a markdown table cell) | `chart/src/text.ts`, `ext-docs/src/rules.ts` | only the escaping is shared: `markdownCell` beside `renderText`. Each caller keeps its own policy for empty and non-string values |
| `BUTTON` (an identical class string) | `chart-ui/src/spec-editor.tsx`, `code-ui/src/code-page.tsx` | a button primitive in `@kb/ui-sdk` |

**What stays out of the SDK:**
- `application` (`@kb/operations`);
- `infrastructure` (stores, `tx-log`, `workspace-fs`, the sandbox engines);
- `app`;
- another family's packages.

### Bundled and repository extensions: one contract, two readings

- **Bundled families import the contract directly.** They are
  Effect-native, built in the same workspace, and versioned with core.
- **Repository extensions (`.kb/extensions`) get `kb-ext-sdk`.** It is the
  portable reading of the same contract: dependency-free, with Promise
  handlers, emitted into the CLI bundle. The two cannot share one import,
  because the ambient module must load with no `@kb/*` and no Effect, and
  must survive a version skew between the repository and the binary.
- **Make the reading a bridge, not a mirror.** Today
  `ext-sdk/tests/surface-bridge.test.ts` holds only `ActionMode` and
  `FailureCode` equal to the contract. Every type that `surface.ts`
  restates gets a fixture: `NodeId`, `PropValue`, `KbNode`,
  `ActionDefinition`, `ActionReceipt`, `KbContext`,
  `ExtensionPromiseHandler`, `ExtensionAction`, `TemplateContext`,
  `TemplateFn`, `ExtensionTemplate`, `ExtensionContribution`,
  `LoadedExtension` and `ExtensionFailure`.
  - A type should be exactly equal (`Same<>`).
  - Where the reading is wider on purpose (the opaque
    `ActionEffectHandler`), the fixture states which way assignability
    runs and why.
  - This closes GAP `01M1PJWF4G6W4122ZE4K67319V`.
- **`@kb/ext-sdk` keeps its name and its job.** It is the
  repository-extension SDK plus the loader's decoder
  (`decodeContribution`). It does not become what bundled packages import.

## 3. The harness rule

**The rule:**

```ts
extension: ["domain", "contract", "kit", "extension"],   // `application` removed
```

So an extension package may import only:
- its own family (`familyEdgeViolation`, unchanged);
- `domain`: `@kb/model`, `@kb/plugin`, `@kb/query`, `@kb/views`;
- `contract`: `@kb/contracts`, `@kb/sandbox`, `@kb/ext-sdk`;
- `kit`: `@kb/ui-sdk`, `@kb/scene`, `@kb/scene-gpu`. `SCOPE_ALLOWS`
  already keeps backend and shared packages off these browser packages.

**How it is checked.** The existing `boundaries` test applies the row to
the import edges (parsed with oxc) and to the declared dependencies.
Nothing new is written for the check:
- The red fixture is an import-graph case in which an extension package
  imports `@kb/operations`.
- The row's home is `LAYER_ALLOWS`, under the existing rule node "Module
  boundaries" (`01M1M0727Z39Z9BMBPBDVHT4Z7`, enforcement `harness`). No new
  rule node is needed.
- Deviation 1 in the `constraints.ts` header ("`layer:extension` may reach
  `application`") is deleted.

**The breach list starts empty.** The row flips in the same step that
removes the last `@kb/operations` import (E15c), so no commit carries a
sanctioned breach and no breach table is added.
- Between E15a and E15c, the importers that remain are named on the open
  gap (below). That window is days long, so a temporary table would cost
  more than it guards.
- If E15b is blocked for long, the fallback is to put the remaining import
  lines (two files) under `// GAP [[id]]` markers, which keeps them under
  the ~30-site limit. That needs the matrix check to read markers, which
  it does not do today. So the default is to wait, not to build that.

## 4. Build steps

The same verify, test and test:ui bar applies as in the
[README's build order](README.md#build-order). The kinds and sizes mean
the same as there.

| # | Step | Kind | Size | Order |
|---|---|---|---|---|
| E15a | Add the **`GraphWrites`** service to `@kb/contracts` (`commit(tx)`, `planNodeAdd(input)`). `kbRuntimeLayer` provides it from `persistEffect` and `planNodeAddEffect`, and it joins `ActionHandlerEnv`. `ext-check/sync.ts` moves onto it. ext-docs reaches rendering through `ReadInvoke` (`render.views`, `render.view {name}`), and `docs.check` must stay clean on this repo with byte-identical `docs/kb/*`; if the receipts lose the per-view warnings, a `DocsRender` port is the fallback. `renderText` moves to `contracts/src/template.ts`. ext-check and ext-docs drop `@kb/operations` from their manifests | restructure | M | can run beside E9b and E13. At most a barrel-line conflict in `operations/src/index.ts` |
| E15b | `ext-canvas/src/{write,verbs}.ts` move onto `GraphWrites`, and `KbStore` and `@kb/operations` leave ext-canvas | restructure | S | **after E9b merges**, because E9b rewrites ext-canvas's id imports. `verbs.ts` holds 3D step 8's agent verbs, so this lands at a 3D step boundary |
| E15c | Fence: `LAYER_ALLOWS.extension` loses `application`, with the red fixture, and the header deviation is deleted. DESIGN.md → Extension families gains the bullet "an extension package builds on domain, contract and kit only". DESIGN.md → Workspace shape is also fixed: its tree predates `kit` and the families, and its sentence "Extension packages can import another extension package's public barrel when their scope permits it" contradicts the family fence | restructure | S | right after E15b. Independent of E14 |
| E16 | Move the copied helpers to their owners (§2 table), one commit per pair; merge a pair only if the copies are one rule | restructure | S | after E15a, which gives `renderText` its new home |
| E17 | Bridge the repository surface: a fixture for every type that `surface.ts` restates. DESIGN.md → Extension SDK calls `kb-ext-sdk` "the portable reading of the contract" | restructure | S | any time |
| E18 | Remove the CLI gate bins' family imports. A family's report reaches the bin through the registry, not through the family's schema: a report shape in `@kb/contracts` (the human lines and a verdict), returned by `docs.check`, `docs.materialize` and `ext.check.audit` and printed by one generic CLI path. Then the three bins import no family, `@kb/cli` drops `@kb/ext-docs` and `@kb/ext-check`, and their `EXTENSION_ROOT_BREACHES` rows go. The CLI's printed text may change | change | M | after E13, so that the breach table then empties completely |

E19 is not scheduled. It is the screen protocol's canvas vocabulary
(§1). A pane's view-specific screen state would become a part
contributed by the view's family, and core's `PaneScreen` would carry it
opaquely. That touches the 3D camera work, so it is minted as a gap now
and planned after E13, at a 3D step boundary.

**Gaps that close:**
- `01M1PJWF4G6W4122ZE4K67319V` (the SDK mirror is not bidirectionally
  typed) closes at E17.
- `01M41H30Y60D3G9WJJX6NFQD2T` (the root fence) closes at E18. E13 removes
  its canvas rows, and only the CLI rows are left. If E14 runs before E18,
  it narrows this gap to those rows rather than closing it.

**Gaps to mint at sign-off**, with markers at the sites named in
`current`:
- `GAP [extensions-reach-core-use-cases]`
  - *expected:* an extension package builds on `domain`, `contract`, `kit`
    and its own family only. Core's write path and render backbone reach
    it as contract services.
  - *current:* `LAYER_ALLOWS.extension` admits `application`. Six files
    import `@kb/operations`: ext-canvas `write.ts` and `verbs.ts`,
    ext-check `sync.ts`, and ext-docs `index.ts`, `rules.ts` and
    `todos.ts`.
  - *impact:* core's use cases are an extension API that nobody declared.
    Changing `persistEffect` or the docs render edits three families, and
    a new extension can reach any use case.
  - *closes:* E15a–E15c.
- `GAP [family-helpers-copied]`
  - *expected:* a helper that two families need has one home in the layer
    they share.
  - *current:* the three pairs in the §2 table.
  - *impact:* a fix to one copy silently misses the other.
  - *closes:* E16.
- `GAP [screen-protocol-names-canvas]`
  - *expected:* core's screen protocol carries a pane's view state
    opaquely, and the canvas family contributes its own part.
  - *current:* `PaneScreen.canvas`, `CanvasScreenSchema` and
    `CANVAS_VIEW_PRESET_NAMES` are in `@kb/contracts`, and `ui.capture` in
    `@kb/operations` is "Capture a canvas".
  - *impact:* screen state is the next feature vocabulary in core that no
    check sees, and it grows with every 3D camera step.
  - *closes:* E19, after E13.

## 5. Questions for the owner

1. **A package, or the layer?** Recommended: the shared SDK is the
   `contract` layer (with the `domain` vocabulary), made true by dropping
   `application` from the extension row. There is no new package.
   - The alternative is a literal `@kb/sdk`. That means splitting the
     action and extension contract out of `@kb/contracts`: about a week of
     work, with every core package re-importing from it. Core's own plugin
     would then build on "the extension SDK" anyway.
   - The result would be the same symbols under a shorter import list.
2. **Symbol-level curation.** Should extensions be limited to a declared
   subset of the domain and contract barrels, for example a ratcheted
   allowlist in `constraints.ts`? Recommended: not yet. While every
   extension builds in this workspace, `tsc` already catches each break.
   The allowlist earns its cost the day an extension is built against
   `@kb/*` outside this repo.

**Owner's answers (2026-10-04).** Both recommendations taken: the shared
SDK is the `contract` layer with the `domain` vocabulary (no `@kb/sdk`
package), and no symbol-level allowlist until an extension builds outside
this workspace.
