import { Context, type Effect } from "effect";
import { z } from "zod";
import { present, type DomainError } from "@kb/model";

/**
 * Screen state: what each open kb UI tab shows, and the commands that move
 * it. It is ephemeral and per tab. A tab publishes its record over `/ws`
 * (`protocol.ts`), the `kb ui` server keeps the latest one per connected tab
 * in memory and forgets it when the socket closes, and nothing here is ever
 * written to the store. `DESIGN.md` → Screen state states the channel and the
 * `ui.*` actions that read and move it; this file types every shape once.
 */

/** A canvas pane's camera and what it shows: the 2D viewport and the ids of the items inside it. */
export const CanvasScreenSchema = z.object({
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
  visible: z.array(z.string()),
});
export type CanvasScreen = z.infer<typeof CanvasScreenSchema>;

/**
 * One pane of a tab: the workspace's panes (Tana-style panels, splits and
 * tabs), every one in the record, and the active one named beside them.
 */
export const PaneScreenSchema = z.object({
  id: z.string().min(1),
  /** Where the pane is: the kb location it shows (the URL's, for the active pane). */
  route: z.string().startsWith("/"),
  /**
   * The view the pane shows: its view key id (`outline.main`,
   * `graph.neighbourhood`, …) — for a node opened at `/node/<id>`, the view
   * it opened in — the view node it shows when it shows one (`node`), and,
   * where the view reports one, the node it is shown for (the outline's root,
   * the canvas node). `null` on a path no view owns.
   */
  view: z
    .object({
      key: z.string().min(1),
      node: z.string().min(1).optional(),
      subject: z.string().min(1).optional(),
    })
    .nullable(),
  /** The node the pane's focus is on, if any. */
  focused: z.string().min(1).nullable(),
  /** What is selected, in the view's own ids: node ids in the outline, item ids on a canvas. */
  selection: z.array(z.string()),
  canvas: CanvasScreenSchema.optional(),
});
export type PaneScreen = z.infer<typeof PaneScreenSchema>;

const screenShape = {
  /** The tab's path, as the router holds it. */
  route: z.string().startsWith("/"),
  /** Whether the tab has the person's attention (its document has focus). */
  active: z.boolean(),
  /** The focused pane: the one the route names and a command without a `pane` goes to. */
  activePane: z.string().min(1),
  panes: z.array(PaneScreenSchema).min(1),
};

function panesAgree(
  state: { activePane: string; panes: readonly PaneScreen[] },
  ctx: z.RefinementCtx,
): void {
  const ids = state.panes.map((pane) => pane.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", message: "pane ids must be unique", path: ["panes"] });
  }
  if (!ids.includes(state.activePane)) {
    ctx.addIssue({
      code: "custom",
      message: `activePane ${state.activePane} names no pane`,
      path: ["activePane"],
    });
  }
}

/** What a tab publishes: its whole screen, replacing the one before. */
export const ScreenStateSchema = z.object(screenShape).superRefine(panesAgree);
export type ScreenState = z.infer<typeof ScreenStateSchema>;

/** A tab's screen as `ui.screen` reports it: the published record under the tab's id. */
export const TabScreenSchema = z
  .object({ tab: z.string().min(1), ...screenShape })
  .superRefine(panesAgree);
export type TabScreen = z.infer<typeof TabScreenSchema>;

/** `ui.screen`'s answer: the live tabs, most recently active first. */
export const ScreenListSchema = z.object({ tabs: z.array(TabScreenSchema) });
export type ScreenList = z.infer<typeof ScreenListSchema>;

// ── commands: what the server asks a tab to do ──────────────────────────

/** Where a navigate goes: a node, opened in the pane's view of it, or a route. */
export const NavigateTargetSchema = z.union([
  z.strictObject({ node: z.string().min(1) }),
  z.strictObject({ route: z.string().startsWith("/") }),
]);
export type NavigateTarget = z.infer<typeof NavigateTargetSchema>;

/** A command a tab carries out. `pane` absent means the tab's active pane. */
export const ScreenCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("navigate"),
    pane: z.string().min(1).optional(),
    to: NavigateTargetSchema,
  }),
  z.object({
    kind: z.literal("select"),
    pane: z.string().min(1).optional(),
    /** Replace the selection; an empty list clears it. */
    selection: z.array(z.string().min(1)).optional(),
    /** Move the focus to this node. */
    focus: z.string().min(1).optional(),
  }),
]);
export type ScreenCommand = z.infer<typeof ScreenCommandSchema>;

const AppliedSchema = z.object({ outcome: z.literal("applied") });
const RejectedSchema = z.object({ outcome: z.literal("rejected"), reason: z.string() });

/** A tab's answer to a command: it carried it out, or it could not and says why. */
export const ScreenAckSchema = z.discriminatedUnion("outcome", [AppliedSchema, RejectedSchema]);
export type ScreenAck = z.infer<typeof ScreenAckSchema>;

/** A tab's answer that it carried the command out. */
export const SCREEN_APPLIED: ScreenAck = { outcome: "applied" };

/** A tab's answer that it could not carry the command out, and why. */
export function screenRejected(reason: string): ScreenAck {
  return { outcome: "rejected", reason };
}

/**
 * What `ui.navigate` and `ui.select` answer. The tab's own answer, under its
 * id; `timeout` when it did not answer within `timeoutMs`; `no-tab` when no
 * live tab could take the command, with the id that was asked for, if one
 * was. A tab that closes before it answers is `no-tab` too: it is not live.
 */
export const ScreenReceiptSchema = z.discriminatedUnion("outcome", [
  AppliedSchema.extend({ tab: z.string() }),
  RejectedSchema.extend({ tab: z.string() }),
  z.object({ outcome: z.literal("timeout"), tab: z.string(), timeoutMs: z.number().int() }),
  z.object({ outcome: z.literal("no-tab"), tab: z.string().optional() }),
]);
export type ScreenReceipt = z.infer<typeof ScreenReceiptSchema>;

/** The receipt of a command no live tab could take; `tab` is the id asked for, if one was. */
export function noTabReceipt(tab: string | undefined): ScreenReceipt {
  return tab === undefined ? { outcome: "no-tab" } : { outcome: "no-tab", tab };
}

/** How long a command waits for its tab by default, and at most. */
export const SCREEN_COMMAND_TIMEOUT_MS = 2000;
export const SCREEN_COMMAND_TIMEOUT_MAX_MS = 30_000;

// ── the `ui.*` actions' inputs ──────────────────────────────────────────

/**
 * An input field a caller may leave out. Some MCP clients send an omitted
 * optional as null, so null is accepted, and it reads as absent.
 */
function omittable<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((value) => value ?? undefined);
}

const tabField = omittable(z.string().min(1));

/** Which tab and pane a command goes to, and how long it waits for the answer. */
const commandTargetShape = {
  tab: tabField,
  pane: omittable(z.string().min(1)),
  timeoutMs: omittable(z.number().int().min(1).max(SCREEN_COMMAND_TIMEOUT_MAX_MS)),
};

export const UiScreenInputSchema = z.object({ tab: tabField });
export type UiScreenInput = z.output<typeof UiScreenInputSchema>;

export const UiNavigateInputSchema = z
  .object({
    ...commandTargetShape,
    node: omittable(z.string().min(1)),
    route: omittable(z.string().startsWith("/")),
  })
  .refine((input) => (input.node === undefined) !== (input.route === undefined), {
    message: "give exactly one of node or route",
  });
export type UiNavigateInput = z.output<typeof UiNavigateInputSchema>;

export const UiSelectInputSchema = z
  .object({
    ...commandTargetShape,
    selection: omittable(z.array(z.string().min(1))),
    focus: omittable(z.string().min(1)),
  })
  .refine((input) => input.selection !== undefined || input.focus !== undefined, {
    message: "give a selection, a focus, or both",
  });
export type UiSelectInput = z.output<typeof UiSelectInputSchema>;

/** The command a `ui.navigate` input asks its tab to carry out. */
export function navigateCommand({ pane, node, route }: UiNavigateInput): ScreenCommand {
  const to: NavigateTarget =
    node === undefined
      ? { route: present(route, "ui.navigate input names neither node nor route") }
      : { node };
  return { kind: "navigate", ...(pane === undefined ? {} : { pane }), to };
}

/** The command a `ui.select` input asks its tab to carry out. */
export function selectCommand({ pane, selection, focus }: UiSelectInput): ScreenCommand {
  return {
    kind: "select",
    ...(pane === undefined ? {} : { pane }),
    ...(selection === undefined ? {} : { selection }),
    ...(focus === undefined ? {} : { focus }),
  };
}

/**
 * The screen channel as a port. The `kb ui` server is where the tabs are, so
 * its adapter is the one that holds them; every other process reaches that
 * server's. A process with no server for its root has no tabs, which is an
 * answer (`no-tab`, an empty list), not a failure.
 */
export interface ScreensPort {
  /** The live tabs, most recently active first; `tab` narrows the list to that one. */
  screen(input: UiScreenInput): Effect.Effect<ScreenList, DomainError>;
  /** Open a node or a route in a tab (the most recently active by default). */
  navigate(input: UiNavigateInput): Effect.Effect<ScreenReceipt, DomainError>;
  /** Set a tab's selection or focus (the most recently active by default). */
  select(input: UiSelectInput): Effect.Effect<ScreenReceipt, DomainError>;
}

export class Screens extends Context.Service<Screens, ScreensPort>()("kb/Screens") {}
