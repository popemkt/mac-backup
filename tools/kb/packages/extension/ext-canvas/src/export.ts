/**
 * `ext.canvas.export` (DESIGN.md → Canvas documents → Export): a canvas as a
 * file another tool opens. `json-canvas` is the document itself, kb's
 * extension fields and every field kb does not read kept as they are, so it
 * is valid JSON Canvas that comes back whole; `svg` is the canvas's top view,
 * painted by the family's SVG painter (`canvasSvg`, `@kb/canvas`), which the
 * look contract holds to what the projections draw.
 */
import { Effect } from "effect";
import { z } from "zod";
import type { ExtensionAction, KbCtx } from "@kb/contracts";
import { canvasSvg, canvasWorld, isNativeEdgeBound, stringifyCanvasDoc } from "@kb/canvas";
import { CanvasIdSchema } from "./schemas.ts";
import { readCanvasEffect, readableEffect, type CanvasFail } from "./write.ts";

/**
 * The formats a canvas exports to.
 * GAP [[01M54EPF1QB5MKA6WRK9DF2X1Y]] png, the SVG rasterised, is not offered: no rasteriser runs under Bun.
 */
const CANVAS_EXPORT_FORMATS = ["svg", "json-canvas"] as const;

/** Each format's media type, which a caller writing the text to a file names it by. */
const MEDIA_TYPES = {
  svg: "image/svg+xml",
  "json-canvas": "application/json",
} as const satisfies { readonly [F in (typeof CANVAS_EXPORT_FORMATS)[number]]: string };

const exportInput = z.object({
  canvasId: CanvasIdSchema,
  format: z.enum(CANVAS_EXPORT_FORMATS),
});
const exportOutput = z.object({
  canvasId: z.string(),
  format: z.enum(CANVAS_EXPORT_FORMATS),
  mediaType: z.string(),
  text: z.string(),
});

const canvasExportEffect = Effect.fn("ext.canvas.export")(function* (
  input: z.infer<typeof exportInput>,
): Effect.fn.Return<z.infer<typeof exportOutput>, CanvasFail, KbCtx> {
  const doc = yield* readCanvasEffect(input.canvasId);
  const readable = yield* readableEffect();
  const byId = new Map(readable.map((node) => [node.id, node]));
  const text =
    input.format === "json-canvas"
      ? stringifyCanvasDoc(doc)
      : canvasSvg(doc, {
          textOf: canvasWorld(readable).textOf,
          bound: (edge) =>
            isNativeEdgeBound(edge, (nodeId, fieldId) => byId.get(nodeId)?.props[fieldId]),
        });
  return {
    canvasId: input.canvasId,
    format: input.format,
    mediaType: MEDIA_TYPES[input.format],
    text,
  };
});

export const canvasExport: ExtensionAction = {
  id: "export",
  title: "Export a canvas",
  description:
    "A canvas as a file another tool opens, answered as text with its media type. json-canvas is " +
    "the document as JSON Canvas 1.0, kb's extension fields and any field kb does not read kept, " +
    "so it reads back whole. svg is the canvas's top view as one standalone SVG: every item and " +
    "edge painted as the canvas paints it, colours and type through the design tokens with the " +
    "default system's values carried in the file, pictures referenced by their asset path. " +
    "PNG is not offered yet; rasterise the SVG, or use ui.capture on an open tab.",
  mode: { kind: "read" },
  inputSchema: exportInput,
  outputSchema: exportOutput,
  effect: canvasExportEffect,
};
