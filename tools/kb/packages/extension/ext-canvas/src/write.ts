/**
 * The canvas family's one write path (DESIGN.md → Canvas documents): a
 * `#canvas` node's document is read from `sys.f.canvas` and written back
 * whole, in one store transaction with whatever else the same act writes —
 * a source node's ref prop for a native edge bind. Every canvas action
 * writes through {@link commitCanvasEffect}; nothing else sets the field.
 */
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import { KbCtx, type KbContext, type KbStore } from "@kb/contracts";
import { persistEffect } from "@kb/operations";
import {
  SYSTEM_IDS,
  isSysPrefixed,
  currentIso,
  ResolveError,
  domainError,
  domainFromResolve,
  type DomainError,
  type KbNode,
  type NodeId,
} from "@kb/model";
import { parseCanvasDoc, stringifyCanvasDoc, type CanvasDoc } from "@kb/canvas";

export class CanvasTxError extends Error {
  readonly code = "invalid_input" as const;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "CanvasTxError";
    this.details = details;
  }
}

export type CanvasFail = DomainError | CanvasTxError;

export function cloneNode(n: KbNode): KbNode {
  return {
    ...n,
    props: Object.fromEntries(
      Object.entries(n.props).map(([k, v]) => [k, v.map((x) => ({ ...x }))]),
    ),
    children: [...n.children],
  };
}

export function requireNode(ctx: KbContext, id: NodeId): KbNode {
  const n = ctx.nodes.find((x) => x.id === id);
  if (!n) throw new ResolveError("not_found", `node not found: ${id}`, { id });
  return n;
}

export function assertUserWritable(id: string): void {
  if (isSysPrefixed(id)) {
    throw new ResolveError("forbidden", `sys.* nodes are write-protected: ${id}`, { id });
  }
}

function assertCanvasHost(ctx: KbContext, id: NodeId): KbNode {
  assertUserWritable(id);
  const node = requireNode(ctx, id);
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  const tagged = types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.canvasTag);
  if (!tagged) {
    // Also accept a user tag named "canvas" typed as sys.tag (text match).
    const canvasTagNodes = ctx.nodes.filter(
      (n) =>
        n.text === "canvas" &&
        (n.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.t === "ref" && v.v === SYSTEM_IDS.tag),
    );
    const ok = types.some((v) => v.t === "ref" && canvasTagNodes.some((t) => t.id === v.v));
    if (!ok) {
      throw new CanvasTxError(`canvas host must be tagged #canvas: ${id}`, { id });
    }
  }
  return node;
}

/** A failure thrown by a synchronous step, as the canvas actions fail. */
function canvasFailure(err: unknown): CanvasFail {
  if (err instanceof CanvasTxError) return err;
  if (err instanceof ResolveError) return domainFromResolve(err);
  return domainError("internal", err instanceof Error ? err.message : String(err));
}

/** Run a synchronous step that may throw, failing as the canvas actions fail. */
function canvasStep<A>(step: () => A): Effect.Effect<A, CanvasFail> {
  return Effect.try({ try: step, catch: canvasFailure });
}

/** The document `raw` (a string or an object), or why it is not one. */
export function parseDocEffect(
  raw: unknown,
  canvasId: string,
): Effect.Effect<CanvasDoc, CanvasFail> {
  return Effect.try({
    try: () => parseCanvasDoc(raw),
    catch: (err) =>
      new CanvasTxError(`invalid canvas doc: ${err instanceof Error ? err.message : String(err)}`, {
        canvasId,
      }),
  });
}

/** What one canvas write commits: the document, and the other nodes the same act changes. */
export interface CanvasWrite {
  readonly canvasId: string;
  readonly doc: CanvasDoc;
  /**
   * The other nodes this write changes, as they are to be stored, each
   * built from a clone (`cloneNode`) and stamped by the caller; written in
   * the same transaction as the document.
   */
  readonly also?: (at: string) => readonly KbNode[];
}

/**
 * Write `doc` onto the `#canvas` node `canvasId`, replacing the document it
 * holds, in one transaction with `also`. Nothing is written when the host is
 * not a canvas or a node `also` builds cannot be. Answers the document as
 * stored.
 */
export const commitCanvasEffect = Effect.fn("ext.canvas.commit")(function* (
  write: CanvasWrite,
): Effect.fn.Return<string, CanvasFail, KbCtx | KbStore | FileSystem> {
  const ctx = yield* KbCtx;
  const docStr = stringifyCanvasDoc(write.doc);
  // One stamp per transaction, from the Clock the store's replay overrides.
  const at = yield* currentIso;
  const canvas = yield* canvasStep(() => cloneNode(assertCanvasHost(ctx, write.canvasId)));
  // Replace (not append) the canvas JSON prop — single current document.
  canvas.props[SYSTEM_IDS.canvasField] = [{ t: "str", v: docStr }];
  canvas.updatedAt = at;
  const also = yield* canvasStep(() => write.also?.(at) ?? []);
  yield* persistEffect(ctx, { upserts: [canvas, ...also], deletes: [] });
  return docStr;
});
