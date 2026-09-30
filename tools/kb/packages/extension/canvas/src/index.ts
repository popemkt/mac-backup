export {
  EMPTY_CANVAS_DOC,
  canvasDepth,
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
  withDepth,
} from "./doc.ts";
export { cameraLookingFrom, posesAgree, projectionOf } from "./camera.ts";
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
