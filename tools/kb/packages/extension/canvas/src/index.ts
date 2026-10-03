export {
  EMPTY_CANVAS_DOC,
  canvasElevation,
  isGroupNode,
  isKbNode,
  isNativeEdgeBound,
  isShapeNode,
  isTextNode,
  paintOrder,
  parseCanvasDoc,
  removeCanvasEdge,
  stringifyCanvasDoc,
  upsertCanvasEdge,
  upsertCanvasNode,
  withCanvasCamera,
  withElevation,
} from "./doc.ts";
export { cameraLookingFrom, posesAgree, projectionOf } from "./camera.ts";
export { presetItem } from "./presets.ts";
export { shapeOutline, svgPathData, tracePath } from "./shapes.ts";
export type { CanvasPresetKind } from "./presets.ts";
export type { CanvasCamera, CanvasPose, CanvasProjectionKind } from "./camera.ts";
export type {
  CanvasDoc,
  CanvasEdge,
  CanvasGroupNode,
  CanvasKbNode,
  CanvasNode,
  CanvasShapeKind,
  CanvasShapeNode,
  CanvasSide,
  CanvasTextNode,
  KbLinkMode,
} from "./doc.ts";
