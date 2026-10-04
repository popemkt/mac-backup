import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import { KbCtx, extensionPlugin, type ExtensionAction, type KbStore } from "@kb/contracts";
import { canvasExtension } from "@kb/canvas";
import { LintDiffSchema } from "./lints.ts";
import { CANVAS_VERBS } from "./verbs.ts";
import {
  CanvasTxError,
  commitCanvasEffect,
  parseDocEffect,
  withPropOps,
  type CanvasFail,
} from "./write.ts";

/**
 * Bundled canvas extension: atomic canvas JSON + relationship prop writes,
 * and the relational verbs an agent edits a canvas with (`verbs.ts`).
 *
 * `ext.canvas.tx.apply` commits one jsonl rewrite that (1) sets
 * `sys.f.canvas` on the canvas node and optionally (2) set/unset props on a
 * source node (native edge bind/unbind). Validation failures throw before
 * persist — nothing is written.
 *
 * Handler is Effect-native (`effect`) — no Promise nest under registry.
 */

const PropInputSchema = z.object({
  field: z.string(),
  value: z.union([
    z.object({ t: z.literal("str"), v: z.string() }),
    z.object({ t: z.literal("num"), v: z.number() }),
    z.object({ t: z.literal("bool"), v: z.boolean() }),
    z.object({ t: z.literal("date"), v: z.string() }),
    z.object({ t: z.literal("ref"), v: z.string() }),
  ]),
});

const applyInput = z.object({
  /** Canvas-tagged node that owns the JSON Canvas document. */
  canvasId: z.string(),
  /** Full document after the client-side patch (object or JSON string). */
  doc: z.union([z.string(), z.record(z.string(), z.unknown())]),
  /** Optional relationship mutations applied atomically with the doc write. */
  propTargetId: z.string().optional(),
  setProps: z.array(PropInputSchema).optional(),
  unsetProps: z.array(z.object({ field: z.string(), value: z.unknown().optional() })).optional(),
});

const applyOutput = z.object({
  canvasId: z.string(),
  doc: z.string(),
  propTargetId: z.string().optional(),
  lints: LintDiffSchema,
});

export const canvasTxApplyEffect = Effect.fn("ext.canvas.tx.apply")(function* (
  input: z.infer<typeof applyInput>,
): Effect.fn.Return<z.infer<typeof applyOutput>, CanvasFail, KbCtx | KbStore | FileSystem> {
  const ctx = yield* KbCtx;
  const doc = yield* parseDocEffect(input.doc, input.canvasId);
  const hasPropOps =
    (input.setProps !== undefined && input.setProps.length > 0) ||
    (input.unsetProps !== undefined && input.unsetProps.length > 0);
  const target = input.propTargetId;
  if (hasPropOps && (target === undefined || target === "")) {
    return yield* Effect.fail(
      new CanvasTxError("propTargetId required when setProps/unsetProps provided"),
    );
  }
  const ops = { set: input.setProps, unset: input.unsetProps };
  const written = yield* commitCanvasEffect({
    canvasId: input.canvasId,
    doc,
    ...(hasPropOps && target !== undefined
      ? { also: (at: string) => [withPropOps(ctx.nodes, target, ops, at)] }
      : {}),
  });
  return {
    canvasId: input.canvasId,
    doc: written.doc,
    ...(hasPropOps ? { propTargetId: target } : {}),
    lints: written.lints,
  };
});

const actions: ExtensionAction[] = [
  {
    id: "tx.apply",
    title: "Apply canvas transaction",
    description:
      "Atomically write a canvas JSON document and optional relationship prop set/unset. " +
      "Items may carry z (height of their base above the floor, the canvas plane; absent is 0) and depth " +
      "(how far they rise from it; absent is flat), and a shape item's shape is rect, ellipse, diamond, " +
      "sphere or cone. The document may carry a camera " +
      "({ projection: 2d | 3d, pose? }); see DESIGN.md, Canvas documents. " +
      "Answers the lints the write made and cleared. To place, lay out, connect, group or promote " +
      "items by relation rather than by coordinates, use the ext.canvas verbs",
    mode: { kind: "write" },
    inputSchema: applyInput,
    outputSchema: applyOutput,
    effect: canvasTxApplyEffect,
  },
  ...CANVAS_VERBS,
];

/** The canvas family's server entry: `ext.canvas.*`, named by the family's declaration. */
export const canvasPlugin = extensionPlugin({ name: canvasExtension.name, actions, templates: [] });
