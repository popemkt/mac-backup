/**
 * `ui.screen`, `ui.navigate`, `ui.select`: what the open kb UI tabs show, and
 * the two commands that move them (`DESIGN.md` → Screen state).
 *
 * They touch no store. Each reads or drives the {@link Screens} port the
 * invoke tip provides: the `kb ui` server holds the tabs, and every other
 * process reaches that server's. They are ordinary registry actions all the
 * same, so the CLI, MCP, HTTP and WebMCP list them and return the same
 * receipt for them, and they run through the one invoke path.
 *
 * The two commands are writes, because they change what a person sees, and
 * they need no approval; `DESIGN.md` → Screen state says why.
 */
import { Effect } from "effect";
import {
  ScreenListSchema,
  ScreenReceiptSchema,
  Screens,
  UiNavigateInputSchema,
  UiScreenInputSchema,
  UiSelectInputSchema,
  type ActionDefinition,
  type ScreenList,
  type ScreenReceipt,
  type UiNavigateInput,
  type UiScreenInput,
  type UiSelectInput,
} from "@kb/contracts";
import type { DomainError } from "@kb/model";

export const uiScreenDef = {
  id: "ui.screen",
  title: "Read the screen",
  description:
    "What each open kb UI tab shows, most recently active first: route, panes, the open view, " +
    "focused node, selection, and a canvas's viewport and visible items. Pass `tab` for one tab.",
  mode: { kind: "read" } as const,
  inputSchema: UiScreenInputSchema,
  outputSchema: ScreenListSchema,
} satisfies ActionDefinition;

export const uiNavigateDef = {
  id: "ui.navigate",
  title: "Navigate a tab",
  description:
    "Open a node (`node`) or a route (`route`) in a kb UI tab, the most recently active by " +
    "default, and/or point the camera of the canvas it shows (`camera`): items to frame (one " +
    "frame alone is looked at face-on), a view preset to look from (top, front, right, back, " +
    "left, oblique), both, or a pose as ui.screen reports one — to show the person something. " +
    "Answers whether a live tab applied it within `timeoutMs`.",
  mode: { kind: "write" } as const,
  inputSchema: UiNavigateInputSchema,
  outputSchema: ScreenReceiptSchema,
} satisfies ActionDefinition;

export const uiSelectDef = {
  id: "ui.select",
  title: "Select in a tab",
  description:
    "Set the selection (`selection`, ids in the open view's terms) or move the focus (`focus`, a " +
    "node id) in a kb UI tab, the most recently active by default. Answers whether a live tab " +
    "applied it within `timeoutMs`.",
  mode: { kind: "write" } as const,
  inputSchema: UiSelectInputSchema,
  outputSchema: ScreenReceiptSchema,
} satisfies ActionDefinition;

export const uiScreenEffect = Effect.fn("ui.screen")(function* (
  input: UiScreenInput,
): Effect.fn.Return<ScreenList, DomainError, Screens> {
  return yield* (yield* Screens).screen(input);
});

export const uiNavigateEffect = Effect.fn("ui.navigate")(function* (
  input: UiNavigateInput,
): Effect.fn.Return<ScreenReceipt, DomainError, Screens> {
  return yield* (yield* Screens).navigate(input);
});

export const uiSelectEffect = Effect.fn("ui.select")(function* (
  input: UiSelectInput,
): Effect.fn.Return<ScreenReceipt, DomainError, Screens> {
  return yield* (yield* Screens).select(input);
});
