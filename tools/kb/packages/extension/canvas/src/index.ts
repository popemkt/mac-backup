export {
  EMPTY_CANVAS_DOC,
  canvasDepth,
  canvasElevation,
  canvasRotation,
  canvasTop,
  isFileNode,
  isGroupNode,
  isKbNode,
  isNativeEdgeBound,
  isShapeNode,
  isTextNode,
  parseCanvasDoc,
  removeCanvasEdge,
  stringifyCanvasDoc,
  upsertCanvasEdge,
  upsertCanvasNode,
  withBillboard,
  withCanvasCamera,
  withDepth,
  withElevation,
  withParent,
  withRotation,
} from "./doc.ts";
export {
  ancestorsOf,
  canvasMembership,
  carriedBy,
  carriedPart,
  editItem,
  groupItems,
  isWithin,
  paintOrder,
  pasteItems,
  placeItems,
  settleMembership,
  transformCarried,
  ungroupItems,
  viewpointFrames,
  withMembers,
} from "./membership.ts";
export type { CanvasCarried, CanvasMembership } from "./membership.ts";
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
export {
  isStill,
  motionBetween,
  motionOf,
  moveBy,
  selectionPivot,
  stillAbout,
  transformItem,
  transformItems,
} from "./transform.ts";
export type { CanvasTransform } from "./transform.ts";
export {
  TOP_AXES,
  boxBounds,
  boxCorners,
  boxFrame,
  boxRotation,
  boxToLocal,
  boxToWorld,
  boxTop,
  directionToLocal,
  directionToWorld,
  facesCamera,
  facingFrame,
  facingLift,
  frameCorners,
  frontFrame,
  frontReach,
  itemFrame,
  planeCorners,
} from "./box.ts";
export type { CanvasAxes, CanvasBounds, CanvasBox, CanvasFrame, CanvasVec } from "./box.ts";
export { cameraLookingFrom, posesAgree, projectionOf } from "./camera.ts";
export { coversFromAbove, rayIntoItem } from "./pick.ts";
export type { CanvasPickItem, CanvasRay } from "./pick.ts";
export { GRID_STEP, snapCanvasMove, snapCarry, snapPrecise, snapToSurface } from "./snap.ts";
export type { SnapGuide, SnappedTransform } from "./snap.ts";
export { canvasExtension } from "./extension.ts";
export { CANVAS_SOLID_PRESETS, imageItem, placedOnFace, presetItem } from "./presets.ts";
export {
  CANVAS_SHAPES,
  faceShare,
  faceStands,
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
  CanvasFileNode,
  CanvasGroupNode,
  CanvasKbNode,
  CanvasNode,
  CanvasShapeKind,
  CanvasShapeNode,
  CanvasSide,
  CanvasTextNode,
  KbLinkMode,
} from "./doc.ts";
