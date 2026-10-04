import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { z } from "zod";
import {
  KbCtx,
  extensionPlugin,
  type ExtensionAction,
  type KbContext,
  type KbStore,
} from "@kb/contracts";
import { resolveFieldId, present, type KbNode, type NodeId, type PropValue } from "@kb/model";
import { canvasExtension } from "@kb/canvas";
import {
  CanvasTxError,
  assertUserWritable,
  cloneNode,
  commitCanvasEffect,
  parseDocEffect,
  requireNode,
  type CanvasFail,
} from "./write.ts";

/**
 * Bundled canvas extension: atomic canvas JSON + relationship prop writes.
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
});

function applySetProps(
  ctx: KbContext,
  props: Record<NodeId, PropValue[]>,
  entries: z.infer<typeof PropInputSchema>[],
): void {
  for (const e of entries) {
    const fieldId = resolveFieldId(ctx.nodes, e.field);
    const list = props[fieldId] ?? [];
    list.push(e.value);
    props[fieldId] = list;
  }
}

function applyUnsetProps(
  ctx: KbContext,
  props: Record<NodeId, PropValue[]>,
  entries: { field: string; value?: unknown }[],
): void {
  for (const u of entries) {
    const fieldId = resolveFieldId(ctx.nodes, u.field);
    if (u.value === undefined) {
      delete props[fieldId];
    } else {
      const list = props[fieldId] ?? [];
      props[fieldId] = list.filter((pv) => JSON.stringify(pv) !== JSON.stringify(u.value));
      if (props[fieldId].length === 0) delete props[fieldId];
    }
  }
}

/** The source node of a native bind with its prop ops applied, stamped `at`. */
function propTarget(ctx: KbContext, input: z.infer<typeof applyInput>, at: string): KbNode {
  const targetId = present(input.propTargetId, "propTargetId");
  assertUserWritable(targetId);
  const t = cloneNode(requireNode(ctx, targetId));
  if (input.setProps) applySetProps(ctx, t.props, input.setProps);
  if (input.unsetProps) applyUnsetProps(ctx, t.props, input.unsetProps);
  t.updatedAt = at;
  return t;
}

export const canvasTxApplyEffect = Effect.fn("ext.canvas.tx.apply")(function* (
  input: z.infer<typeof applyInput>,
): Effect.fn.Return<z.infer<typeof applyOutput>, CanvasFail, KbCtx | KbStore | FileSystem> {
  const ctx = yield* KbCtx;
  const doc = yield* parseDocEffect(input.doc, input.canvasId);
  const hasPropOps =
    (input.setProps !== undefined && input.setProps.length > 0) ||
    (input.unsetProps !== undefined && input.unsetProps.length > 0);
  if (hasPropOps && (input.propTargetId === undefined || input.propTargetId === "")) {
    return yield* Effect.fail(
      new CanvasTxError("propTargetId required when setProps/unsetProps provided"),
    );
  }
  const stored = yield* commitCanvasEffect({
    canvasId: input.canvasId,
    doc,
    ...(hasPropOps ? { also: (at: string) => [propTarget(ctx, input, at)] } : {}),
  });
  return {
    canvasId: input.canvasId,
    doc: stored,
    ...(hasPropOps ? { propTargetId: input.propTargetId } : {}),
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
      "({ projection: 2d | 3d, pose? }); see DESIGN.md, Canvas documents",
    mode: { kind: "write" },
    inputSchema: applyInput,
    outputSchema: applyOutput,
    effect: canvasTxApplyEffect,
  },
];

/** The canvas family's server entry: `ext.canvas.*`, named by the family's declaration. */
export const canvasPlugin = extensionPlugin({ name: canvasExtension.name, actions, templates: [] });
