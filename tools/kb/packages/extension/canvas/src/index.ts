export {
  EMPTY_CANVAS_DOC,
  canvasDepth,
  canvasElevation,
  canvasTop,
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
  withElevation,
} from "./doc.ts";
export {
  boxCorners,
  boxFrame,
  boxToLocal,
  boxToWorld,
  boxTop,
  directionToLocal,
  directionToWorld,
} from "./box.ts";
export type { CanvasBox, CanvasFrame, CanvasVec } from "./box.ts";
export { cameraLookingFrom, posesAgree, projectionOf } from "./camera.ts";
export { CANVAS_SOLID_PRESETS, presetItem } from "./presets.ts";
export {
  CANVAS_SHAPES,
  itemShape,
  onFootprint,
  outlinePoints,
  shapeOutline,
  svgPathData,
  tracePath,
} from "./shapes.ts";
export type { CanvasFootprint, CanvasPathSink, CanvasVolume } from "./shapes.ts";
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
