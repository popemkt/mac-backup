# O3a: `@kb/ui-sdk` exports by the families that use them

Audit of 2026-10-16 (Sonnet, read-only) over the barrel's 325 exports,
counting imports from `app/ui`, `extension/*-ui`, `kit/scene`,
`kit/scene-gpu` and `ui-test-kit`; test-only use counted apart. It feeds
decision 5 of the [plan](README.md): the kit keeps only what more than one
family uses. It is a snapshot at `41e029e6`, re-run before O3 lands.

| Verdict | Count |
|---|---|
| Shared by two or more groups | 131 |
| Shared only through another shared ui-sdk module | 62 |
| Outline only | 32 |
| Graph only | 8 |
| Shell only | 52 |
| One extension only (canvas 10, lab 6, chart 3, agent 2, scene 1) | 22 |
| Used by tests only | 18 |

## Move with O3 (outline only)

`NodeTextHostProps`; `useSlotChain`; `OptionChip`; `caret.ts`'s
`VerticalNavDecision`, `readCaretGeometry`, `verticalArrowDecision`;
`NodeCommandStep`, `PaletteSurface`; `rowTextOf`, `shownNodeId`;
`emptyValueForType`, `isValueMismatch`, `resolveFieldTypeById`;
`bulletClickIntent`, `followHowOf`; `formatPropValue`, `loadExpandedIds`,
`saveExpandedIds`; `guideLineStyle`; `hostOfInstance`, `isProjectedInstance`,
`outlineHostOfPane`; `CREATE_ROW_ID`, `orderCandidates`; `refCreationOf`,
`refSearchOf`, `refUses`; `fieldContextOf`; `TAG_PALETTE`, `optionColorOf`,
`tagColorAlpha`; `DatascriptIndex`.

## Move with O4 (graph only)

`bulletExtent`, `GRAPH_LABEL_WIDTH`, `fitGraphLabel`, `LensTreeNode`,
`buildTreeForest`, `lensReport`, `keptLoad`, `graphPath`.

## Findings that shape O3 and O4

1. **`app/ui/src/lib` hides two zones.** `bullet-gpu`, `graph-label-paint`,
   `graph-neighbourhood` and the `lib/graph-*` files are imported only by
   `components/graph/`; `row-chrome`, `visible-instances`,
   `selection-keymap`, `value-slot-keymap` and `value-kind` only by the
   outline. They move with their family, and about 25 of the "shared"
   exports turn out single-family once those files are attributed to it.
2. **The text-editing core stays in the kit.** `NodeTextHost` is used by the
   outline and by `canvas-ui`'s kb-node card, so `md-edit`, `caret`,
   `use-reveal-markup`, `use-text-history`, `tag-chip` and `md-view` stay;
   only exports no one outside the kit reads leave the barrel.
3. **The kit carries shell-only code.** About 13 theme and preference
   exports in `lib/theme.ts` and 9 kernel exports in `lib/plugins.ts`
   (`Dock`, `syncUiPlugins`, `matchRoute`, `subscribeUiKernel`, …) are read
   only by the shell. The shell builds the page kernel on the kit, so they
   are not a plugin seam; whether they belong in `app/ui` is open, outside
   this plan.
4. **18 exports are read only by tests** (`TagChip`, `ELEVATIONS`,
   `TYPE_STEPS`, `FIELD_TYPES`, `findView`, `POINTER_SLOP`, …): dead seams
   in the barrel, to drop or wire when their module is next touched.
5. `ui-test-kit` makes about 8 exports read as shared (`CaretIntent`,
   `PaneReport`, `BrowserHost`, `schemaOf`, …) with no second real consumer.
