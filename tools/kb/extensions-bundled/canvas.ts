import { Effect } from "effect";
import { z } from "zod";
import type { KbContext } from "../src/context.ts";
import { KbCtx, persistEffect, runWithKb } from "../src/context.ts";
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
  domainError,
  domainFromResolve,
  type DomainError,
} from "../src/foundation/errors.ts";
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

function assertCanvasHost(ctx: KbContext, id: NodeId): KbNode {
  assertUserWritable(id);
  const node = requireNode(ctx, id);
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  const tagged = types.some(
    (v) => v.t === "ref" && v.v === SYSTEM_IDS.canvasTag,
  );
  if (!tagged) {
    // Also accept a user tag named "canvas" typed as sys.tag (text match).
    const canvasTagNodes = ctx.nodes.filter(
      (n) =>
        n.text === "canvas" &&
        (n.props[SYSTEM_IDS.typeField] ?? []).some(
          (v) => v.t === "ref" && v.v === SYSTEM_IDS.tag,
        ),
    );
    const ok = types.some(
      (v) => v.t === "ref" && canvasTagNodes.some((t) => t.id === v.v),
    );
    if (!ok) {
      throw new CanvasTxError(
        `canvas host must be tagged #canvas: ${id}`,
        { id },
      );
    }
  }
  return node;
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

type CanvasFail = DomainError | CanvasTxError;

const canvasTxApplyEffect = Effect.fn("ext.canvas.tx.apply")(
  function* (
    input: z.infer<typeof applyInput>,
  ): Effect.fn.Return<z.infer<typeof applyOutput>, CanvasFail, KbCtx> {
    const ctx = yield* KbCtx;

    const parsed: CanvasDoc = yield* Effect.try({
      try: () => parseCanvasDoc(input.doc),
      catch: (err) =>
        new CanvasTxError(
          `invalid canvas doc: ${err instanceof Error ? err.message : String(err)}`,
          { canvasId: input.canvasId },
        ),
    });
    const docStr = stringifyCanvasDoc(parsed);

    const canvas = yield* Effect.try({
      try: () => cloneNode(assertCanvasHost(ctx, input.canvasId)),
      catch: (err) => {
        if (err instanceof CanvasTxError) return err;
        if (err instanceof ResolveError) return domainFromResolve(err);
        return domainError(
          "internal",
          err instanceof Error ? err.message : String(err),
        );
      },
    });
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
        return yield* Effect.fail(
          new CanvasTxError(
            "propTargetId required when setProps/unsetProps provided",
          ),
        );
      }
      const target = yield* Effect.try({
        try: () => {
          assertUserWritable(input.propTargetId!);
          const t = cloneNode(requireNode(ctx, input.propTargetId!));
          if (input.setProps) applySetProps(ctx, t.props, input.setProps);
          if (input.unsetProps) {
            applyUnsetProps(ctx, t.props, input.unsetProps);
          }
          t.updatedAt = nowIso();
          return t;
        },
        catch: (err) => {
          if (err instanceof CanvasTxError) return err;
          if (err instanceof ResolveError) return domainFromResolve(err);
          return domainError(
            "internal",
            err instanceof Error ? err.message : String(err),
          );
        },
      });
      upserts.push(target);
      propTargetId = input.propTargetId;
    }

    yield* persistEffect(ctx, { upserts, deletes: [] });
    return { canvasId: input.canvasId, doc: docStr, propTargetId };
  },
);

async function canvasTxApply(
  ctx: KbContext,
  input: z.infer<typeof applyInput>,
): Promise<z.infer<typeof applyOutput>> {
  return runWithKb(ctx, canvasTxApplyEffect(input));
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
