/**
 * The canvas family's one write path (DESIGN.md → Canvas documents): a
 * `#canvas` node's document is read from `sys.f.canvas` and written back
 * whole, in one store transaction with whatever else the same act writes —
 * a source node's ref prop for a native edge bind. Every canvas action
 * writes through {@link commitCanvasEffect}; nothing else sets the field,
 * and every write answers what it did to the canvas's lints.
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
  resolveFieldId,
  type DomainError,
  type KbNode,
  type NodeId,
  type PropValue,
} from "@kb/model";
import {
  CANVAS_IDS,
  CanvasRelationError,
  lintCanvas,
  lintDiff,
  parseCanvasDoc,
  stringifyCanvasDoc,
  type CanvasDoc,
  type CanvasLintDiff,
} from "@kb/canvas";

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
    throw new ResolveError("forbidden", `sys.* nodes are write-protected: ${id}`, { id });
  }
}

function assertCanvasHost(ctx: KbContext, id: NodeId): KbNode {
  assertUserWritable(id);
  const node = requireNode(ctx, id);
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  const tagged = types.some((v) => v.t === "ref" && v.v === CANVAS_IDS.canvasTag);
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
  // A relation the canvas cannot resolve is the caller's to fix, in its words.
  if (err instanceof CanvasRelationError) return new CanvasTxError(err.message);
  if (err instanceof ResolveError) return domainFromResolve(err);
  return domainError("internal", err instanceof Error ? err.message : String(err));
}

/** Run a synchronous step that may throw, failing as the canvas actions fail. */
export function canvasStep<A>(step: () => A): Effect.Effect<A, CanvasFail> {
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

/** A prop a canvas write sets on a node beside the document: a field (name or id) and a value. */
export interface CanvasPropSet {
  readonly field: string;
  readonly value: PropValue;
}

/** A prop a canvas write unsets: every value of the field, or the one given. */
export interface CanvasPropUnset {
  readonly field: string;
  readonly value?: unknown;
}

/**
 * Node `id` with `set` added and `unset` taken away, stamped `at`: the
 * other node a native edge bind or unbind writes beside the document.
 */
export function withPropOps(
  nodes: KbNode[],
  id: NodeId,
  ops: { readonly set?: readonly CanvasPropSet[]; readonly unset?: readonly CanvasPropUnset[] },
  at: string,
): KbNode {
  assertUserWritable(id);
  const found = nodes.find((n) => n.id === id);
  if (found === undefined) throw new ResolveError("not_found", `node not found: ${id}`, { id });
  const node = cloneNode(found);
  const { props } = node;
  for (const e of ops.set ?? []) {
    const fieldId = resolveFieldId(nodes, e.field);
    props[fieldId] = [...(props[fieldId] ?? []), e.value];
  }
  for (const u of ops.unset ?? []) {
    const fieldId = resolveFieldId(nodes, u.field);
    const kept =
      u.value === undefined
        ? []
        : (props[fieldId] ?? []).filter((pv) => JSON.stringify(pv) !== JSON.stringify(u.value));
    if (kept.length === 0) delete props[fieldId];
    else props[fieldId] = kept;
  }
  node.updatedAt = at;
  return node;
}

/** The document a `#canvas` node holds; an empty canvas when it holds none it can read. */
function storedDoc(host: KbNode): CanvasDoc {
  const raw = host.props[CANVAS_IDS.canvasField]?.[0];
  if (raw === undefined || raw.t !== "str") return { nodes: [], edges: [] };
  try {
    return parseCanvasDoc(raw.v);
  } catch {
    return { nodes: [], edges: [] };
  }
}

/**
 * The document on the `#canvas` node `canvasId`, which a verb resolves its
 * relations against and writes back whole; refused when the node is not a
 * canvas, or holds a document kb cannot read — writing a verb's result over
 * it would lose everything else on it. A canvas with none is empty.
 */
export const readCanvasEffect = Effect.fn("ext.canvas.read")(function* (
  canvasId: string,
): Effect.fn.Return<CanvasDoc, CanvasFail, KbCtx> {
  const ctx = yield* KbCtx;
  const host = yield* canvasStep(() => assertCanvasHost(ctx, canvasId));
  const raw = host.props[CANVAS_IDS.canvasField]?.[0];
  if (raw === undefined) return { nodes: [], edges: [] };
  if (raw.t !== "str") {
    return yield* Effect.fail(
      new CanvasTxError(`canvas ${canvasId} holds no document kb can read`),
    );
  }
  return yield* parseDocEffect(raw.v, canvasId);
});

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

/** What a canvas write answers: the document as stored, and the lints it made and cleared. */
export interface CanvasWritten {
  readonly doc: string;
  readonly lints: CanvasLintDiff;
}

/**
 * Write `doc` onto the `#canvas` node `canvasId`, replacing the document it
 * holds, in one transaction with `also`. Nothing is written when the host is
 * not a canvas or a node `also` builds cannot be. Answers the document as
 * stored and what the write did to the canvas's lints (`lintDiff`), so
 * every canvas write's receipt says what it broke and what it fixed.
 */
export const commitCanvasEffect = Effect.fn("ext.canvas.commit")(function* (
  write: CanvasWrite,
): Effect.fn.Return<CanvasWritten, CanvasFail, KbCtx | KbStore | FileSystem> {
  const ctx = yield* KbCtx;
  const docStr = stringifyCanvasDoc(write.doc);
  // One stamp per transaction, from the Clock the store's replay overrides.
  const at = yield* currentIso;
  const host = yield* canvasStep(() => assertCanvasHost(ctx, write.canvasId));
  const canvas = cloneNode(host);
  // Replace (not append) the canvas JSON prop — single current document.
  canvas.props[CANVAS_IDS.canvasField] = [{ t: "str", v: docStr }];
  canvas.updatedAt = at;
  const also = yield* canvasStep(() => write.also?.(at) ?? []);
  const known = new Set([...ctx.nodes, ...also].map((node) => node.id));
  const before = lintCanvas(storedDoc(host), (id) => known.has(id));
  const after = lintCanvas(write.doc, (id) => known.has(id));
  yield* persistEffect(ctx, { upserts: [canvas, ...also], deletes: [] });
  return { doc: docStr, lints: lintDiff(before, after) };
});
