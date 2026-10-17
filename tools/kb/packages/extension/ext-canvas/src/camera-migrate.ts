/**
 * `ext.canvas.camera.migrate` (DESIGN.md → Canvas documents → Camera): the
 * move of a canvas's camera off its document and onto the canvas view node
 * it is looked at through, run on purpose, as `views.migrate` is. A canvas
 * whose document still carries its own `camera` key gets that camera as a
 * setting of its view node (`canvasViewIdOf`), or of a new one proposed for
 * it as `view.propose` would (`planViewProposal`) when it names none, and
 * the key leaves its document in the same commit. A view node that already
 * holds a camera keeps its own. Each canvas is one planned write, landing
 * only on the state it was planned from. A camera kb cannot read stays
 * where it is, reported; a canvas with no camera is left alone, so running
 * it again writes nothing.
 */
import { Effect } from "effect";
import { z } from "zod";
import { KbCtx, type ExtensionAction, type KbContext, type KbStore } from "@kb/contracts";
import {
  CANVAS_IDS,
  CanvasView,
  LEGACY_CAMERA_KEY,
  canvasCameraProps,
  canvasViewIdOf,
  isCanvasNode,
  parseCanvasDoc,
  parseLegacyCamera,
  readCanvasCamera,
  stringifyCanvasDoc,
  type CanvasCamera,
  type CanvasDoc,
} from "@kb/canvas";
import { currentIso, type DomainError, type KbNode, type NodeId } from "@kb/model";
import { persistPlannedEffect, planViewProposal } from "@kb/operations";

const migrateOutput = z.object({
  /** The canvases whose camera moved onto a view node. */
  moved: z.array(z.string()),
  /** The canvases whose document holds a camera kb cannot read, left as it is. */
  unread: z.array(z.string()),
});
type MigrateOutput = z.infer<typeof migrateOutput>;

/** What a canvas's document holds under its own camera key, or undefined for none or no document. */
function legacyCameraOf(canvas: KbNode): { doc: CanvasDoc; raw: unknown } | undefined {
  const [stored] = canvas.props[CANVAS_IDS.canvasField] ?? [];
  if (stored?.t !== "str") return undefined;
  try {
    const doc = parseCanvasDoc(stored.v);
    const raw = doc.extra?.[LEGACY_CAMERA_KEY];
    return raw === undefined ? undefined : { doc, raw };
  } catch {
    return undefined;
  }
}

/** `canvas` holding `doc` with no camera key of its own. */
function withoutCamera(canvas: KbNode, doc: CanvasDoc, at: string): KbNode {
  const { [LEGACY_CAMERA_KEY]: _camera, ...rest } = doc.extra ?? {};
  const stripped: CanvasDoc = { ...doc, extra: rest };
  if (Object.keys(rest).length === 0) delete stripped.extra;
  return {
    ...canvas,
    props: {
      ...canvas.props,
      [CANVAS_IDS.canvasField]: [{ t: "str", v: stringifyCanvasDoc(stripped) }],
    },
    updatedAt: at,
  };
}

/** The write that moves `camera` onto the view node `canvas` is looked at through. */
const planMove = Effect.fn("ext.canvas.camera.migrate.plan")(function* (
  ctx: KbContext,
  canvas: KbNode,
  doc: CanvasDoc,
  camera: CanvasCamera,
): Effect.fn.Return<{ upserts: KbNode[]; deletes: NodeId[] }, DomainError> {
  const at = yield* currentIso;
  const moved = withoutCamera(canvas, doc, at);
  const viewId = canvasViewIdOf(canvas, (id) => ctx.index.getNode(id));
  const view = viewId === null ? undefined : ctx.index.getNode(viewId);
  if (view !== undefined) {
    // A view node that looks through a camera of its own keeps it.
    if (readCanvasCamera(view.props) !== undefined) return { upserts: [moved], deletes: [] };
    const looking = {
      ...view,
      props: { ...view.props, ...canvasCameraProps(camera) },
      updatedAt: at,
    };
    return { upserts: [moved, looking], deletes: [] };
  }
  const planned = yield* planViewProposal(ctx, CanvasView, {
    params: { id: canvas.id, ...camera },
    host: canvas.id,
    text: "",
    default: false,
  });
  const upserts = planned.upserts.map((node) =>
    node.id === canvas.id ? withoutCamera(node, doc, at) : node,
  );
  return { upserts, deletes: [] };
});

const cameraMigrateEffect = Effect.fn("ext.canvas.camera.migrate")(function* (): Effect.fn.Return<
  MigrateOutput,
  DomainError,
  KbCtx | KbStore
> {
  const ctx = yield* KbCtx;
  const moved: string[] = [];
  const unread = new Set<string>();
  for (const id of ctx.nodes.filter(isCanvasNode).map((node) => node.id)) {
    const written = yield* persistPlannedEffect(ctx, () =>
      Effect.gen(function* () {
        const canvas = ctx.index.getNode(id);
        const held = canvas === undefined ? undefined : legacyCameraOf(canvas);
        if (canvas === undefined || held === undefined) return null;
        const camera = parseLegacyCamera(held.raw);
        if (camera === undefined) {
          unread.add(id);
          return null;
        }
        return yield* planMove(ctx, canvas, held.doc, camera);
      }),
    );
    if (written !== null) moved.push(id);
  }
  return { moved, unread: [...unread] };
});

export const canvasCameraMigrate: ExtensionAction = {
  id: "camera.migrate",
  title: "Move canvas cameras onto their view nodes",
  description:
    "Move the camera of every canvas whose document still carries one (its own `camera` key, " +
    "written before a canvas's camera became its view node's setting) onto the canvas view node " +
    "it is looked at through, proposing one for it when it names none, and take the key out of " +
    "its document in the same write. A view node that already holds a camera keeps its own. " +
    "Answers which canvases moved, and which hold a camera kb cannot read, left as they are. " +
    "Running it again writes nothing.",
  mode: { kind: "write" },
  inputSchema: z.object({}),
  outputSchema: migrateOutput,
  effect: cameraMigrateEffect,
};
