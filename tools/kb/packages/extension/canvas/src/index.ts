export {
  EMPTY_CANVAS_DOC,
  canvasDepth,
  canvasElevation,
  canvasRotation,
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
  withRotation,
} from "./doc.ts";
export {
  IDENTITY,
  NO_ROTATION,
  apply,
  axisAngleOf,
  isUnrotated,
  multiply,
  normalizeDegrees,
  rotationMatrix,
  rotationOfMatrix,
  transpose,
  turnAbout,
} from "./rotation.ts";
export type { CanvasMatrix, CanvasRotation } from "./rotation.ts";
export { moveBy, selectionPivot, stillAbout, transformItem, transformItems } from "./transform.ts";
export type { CanvasTransform } from "./transform.ts";
export {
  boxCorners,
  boxFrame,
  boxRotation,
  boxToLocal,
  boxToWorld,
  boxTop,
  directionToLocal,
  directionToWorld,
  planeCorners,
} from "./box.ts";
export type { CanvasBox, CanvasFrame, CanvasVec } from "./box.ts";
export { cameraLookingFrom, posesAgree, projectionOf } from "./camera.ts";
export { canvasExtension } from "./extension.ts";
export { CANVAS_SOLID_PRESETS, presetItem } from "./presets.ts";
export {
  CANVAS_SHAPES,
  faceShare,
  itemShape,
  onFootprint,
  outlinePoints,
  shapeOutline,
  svgPathData,
  topView,
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
