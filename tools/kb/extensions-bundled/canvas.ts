import { z } from "zod";
import type { KbContext } from "../src/context.ts";
import { persist } from "../src/context.ts";
import type { ExtensionAction } from "../src/extensions.ts";
import {
  SYSTEM_IDS,
  isSysPrefixed,
  nowIso,
  type KbNode,
  type NodeId,
  type PropValue,
} from "../src/foundation/model.ts";
import { ResolveError, resolveFieldId } from "../src/foundation/resolve.ts";
import {
  parseCanvasDoc,
  stringifyCanvasDoc,
  type CanvasDoc,
} from "../src/canvas/doc.ts";

/**
 * Bundled canvas extension: atomic canvas JSON + relationship prop writes.
 *
 * `ext.canvas.tx.apply` commits one jsonl rewrite that (1) sets
 * `sys.f.canvas` on the canvas node and optionally (2) set/unset props on a
 * source node (native edge bind/unbind). Validation failures throw before
 * persist — nothing is written.
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
  unsetProps: z
    .array(z.object({ field: z.string(), value: z.unknown().optional() }))
    .optional(),
});

const applyOutput = z.object({
  canvasId: z.string(),
  doc: z.string(),
  propTargetId: z.string().optional(),
});

function cloneNode(n: KbNode): KbNode {
  return {
    ...n,
    props: Object.fromEntries(
      Object.entries(n.props).map(([k, v]) => [k, v.map((x) => ({ ...x }))]),
    ),
    children: [...n.children],
  };
}

function requireNode(ctx: KbContext, id: NodeId): KbNode {
  const n = ctx.nodes.find((x) => x.id === id);
  if (!n) throw new ResolveError("not_found", `node not found: ${id}`, { id });
  return n;
}

function assertUserWritable(id: string): void {
  if (isSysPrefixed(id)) {
    throw new ResolveError(
      "forbidden",
      `sys.* nodes are write-protected: ${id}`,
      { id },
    );
  }
}

function applySetProps(
  ctx: KbContext,
  props: Record<NodeId, PropValue[]>,
  entries: z.infer<typeof PropInputSchema>[],
): void {
  for (const e of entries) {
    const fieldId = resolveFieldId(ctx.nodes, e.field);
    const list = props[fieldId] ?? [];
    list.push(e.value as PropValue);
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
      props[fieldId] = list.filter(
        (pv) => JSON.stringify(pv) !== JSON.stringify(u.value),
      );
      if (props[fieldId]!.length === 0) delete props[fieldId];
    }
  }
}

class CanvasTxError extends Error {
  readonly code = "invalid_input" as const;
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CanvasTxError";
  }
}

async function canvasTxApply(
  ctx: KbContext,
  input: z.infer<typeof applyInput>,
): Promise<z.infer<typeof applyOutput>> {
  assertUserWritable(input.canvasId);

  // Parse/validate doc before any mutation — failure rolls back (no write).
  let parsed: CanvasDoc;
  try {
    parsed = parseCanvasDoc(input.doc);
  } catch (err) {
    throw new CanvasTxError(
      `invalid canvas doc: ${err instanceof Error ? err.message : String(err)}`,
      { canvasId: input.canvasId },
    );
  }
  const docStr = stringifyCanvasDoc(parsed);

  const canvas = cloneNode(requireNode(ctx, input.canvasId));
  // Replace (not append) the canvas JSON prop — single current document.
  canvas.props[SYSTEM_IDS.canvasField] = [{ t: "str", v: docStr }];
  canvas.updatedAt = nowIso();

  const upserts: KbNode[] = [canvas];
  let propTargetId: string | undefined;

  const hasPropOps =
    (input.setProps !== undefined && input.setProps.length > 0) ||
    (input.unsetProps !== undefined && input.unsetProps.length > 0);

  if (hasPropOps) {
    if (!input.propTargetId) {
      throw new CanvasTxError(
        "propTargetId required when setProps/unsetProps provided",
      );
    }
    assertUserWritable(input.propTargetId);
    const target = cloneNode(requireNode(ctx, input.propTargetId));
    if (input.setProps) applySetProps(ctx, target.props, input.setProps);
    if (input.unsetProps) applyUnsetProps(ctx, target.props, input.unsetProps);
    target.updatedAt = nowIso();
    upserts.push(target);
    propTargetId = input.propTargetId;
  }

  await persist(ctx, { upserts, deletes: [] });
  return { canvasId: input.canvasId, doc: docStr, propTargetId };
}

const actions: ExtensionAction[] = [
  {
    id: "tx.apply",
    title: "Apply canvas transaction",
    description:
      "Atomically write a canvas JSON document and optional relationship prop set/unset",
    mode: "apply",
    inputSchema: applyInput,
    outputSchema: applyOutput,
    handler: canvasTxApply,
  },
];

export default actions;
