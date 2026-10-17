/**
 * The canvas family's shared package (DESIGN.md → Extension families): the
 * JSON Canvas document and the geometry and verbs over it, the family's ids,
 * view keys and seed, and the declaration and shared plugin both hosts load.
 */
export {
  CANVAS_HEADS,
  CANVAS_SIDES,
  CANVAS_ROUTES,
  EMPTY_CANVAS_DOC,
  canvasDepth,
  canvasElevation,
  canvasRotation,
  canvasTop,
  isFileNode,
  isGroupNode,
  isKbNode,
  isNativeEdgeBound,
  isPathNode,
  isPictureFile,
  isShapeNode,
  isTextNode,
  parseCanvasDoc,
  removeCanvasEdge,
  stringifyCanvasDoc,
  upsertCanvasEdge,
  upsertCanvasNode,
  withFlag,
  withLink,
  isLinkUrl,
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
  deleteItems,
  carriedPart,
  freeItems,
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
export type { CanvasFlipAxis, CanvasTransform } from "./transform.ts";
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
export {
  CANVAS_ALIGN_EDGES,
  CANVAS_LAYOUTS,
  CANVAS_ORDERS,
  arrangeItems,
  flipItems,
  orderItems,
} from "./arrange.ts";
export type {
  CanvasAlignEdge,
  CanvasArrangement,
  CanvasLayerValue,
  CanvasLayout,
  CanvasOrder,
} from "./arrange.ts";
export { connectItems } from "./connect.ts";
export {
  CARD_BODY_FALLBACK,
  CARD_BODY_STEP,
  CORNER_RADII_FALLBACKS,
  cornerRadius,
  FLEX_PLACES,
  FONT_FACES,
  SELECTED_OUTLINE,
  TEXT_ALIGNS,
  TONE_TOKENS,
  TYPE_STEPS,
  TYPE_STEP_FALLBACKS,
  edgePaint,
  itemPaint,
} from "./paint.ts";
export type {
  CanvasTypeStep,
  CornerRadii,
  ChromePaint,
  EdgePaint,
  EdgeState,
  ItemPaint,
  Tone,
  ToneSource,
  WordsPaint,
} from "./paint.ts";
export { paintCss, paletteToken, toneCss } from "./paint-css.ts";
export { canvasSvg } from "./svg.ts";
export { DIAGRAM_FLOWS, diagramDoc } from "./diagram.ts";
export type { DiagramBox, DiagramFlow, DiagramLink, DiagramSpec } from "./diagram.ts";
export { mermaidDiagram } from "./mermaid.ts";
export type { MermaidDiagram, MermaidReport } from "./mermaid.ts";
export type { SvgSource } from "./svg.ts";
export { isOpenLine, itemOutline, pathHeads, withLine } from "./paths.ts";
export type { CanvasLinePatch } from "./paths.ts";
export {
  anchorNear,
  edgeHead,
  edgeRoute,
  headOf,
  looseRoute,
  routeBends,
  routeMidpoint,
  routePoints,
  sideTerminal,
  withEnd,
  withHead,
  withRoute,
} from "./edges.ts";
export type {
  CanvasEnded,
  EdgeEnd,
  EdgeHead,
  EdgeRoute,
  EdgeRoutePatch,
  EdgeTerminal,
} from "./edges.ts";
export type { CanvasConnection } from "./connect.ts";
export { describeCanvas, itemKind } from "./describe.ts";
export type {
  CanvasDescription,
  DescribedCluster,
  DescribedItem,
  DescribedLine,
  DescribedRelation,
} from "./describe.ts";
export { CANVAS_LINT_RULES, lintCanvas, lintDiff } from "./lint.ts";
export { canvasReferences } from "./references.ts";
export { boardOf, canvasPages, nextPageName } from "./pages.ts";
export { canvasWorld, isCanvasNode } from "./world.ts";
export type { CanvasWorld, WorldNode } from "./world.ts";
export type { CanvasLint, CanvasLintDiff, CanvasLintRule } from "./lint.ts";
export { placeItem } from "./place.ts";
export type { CanvasWhere } from "./place.ts";
export { promotableText, promoteItem } from "./promote.ts";
export {
  CANVAS_DIRECTIONS,
  CanvasRelationError,
  directionFrom,
  facingSides,
  itemBounds,
  overlaps,
} from "./relations.ts";
export type { CanvasDirection } from "./relations.ts";
export { coversFromAbove, rayIntoItem } from "./pick.ts";
export type { CanvasPickItem, CanvasRay } from "./pick.ts";
export {
  GRID_STEP,
  restingOn,
  snapCanvasMove,
  snapCarry,
  snapPrecise,
  snapToSurface,
} from "./snap.ts";
export type { SnapGuide, SnappedTransform } from "./snap.ts";
export {
  CANVAS_PALETTE,
  canvasColor,
  isCanvasColor,
  drawsGround,
  ownsWords,
  paintName,
  styleOf,
  withStyle,
  writtenLooks,
} from "./style.ts";
export type { CanvasLooksPatch, CanvasPaint, CanvasPaletteId, CanvasStyle } from "./style.ts";
export {
  CANVAS_ALIGNS,
  CANVAS_DASHES,
  CANVAS_FILLS,
  CANVAS_FONTS,
  CANVAS_SIZES,
  CANVAS_VALIGNS,
} from "./style-fields.ts";
export type {
  CanvasAlign,
  CanvasDash,
  CanvasFill,
  CanvasFont,
  CanvasLooks,
  CanvasSize,
  CanvasVAlign,
} from "./style-fields.ts";
export { CANVAS_IDS } from "./ids.ts";
export { CANVAS_EVENTS, CanvasListView, CanvasParams, CanvasView } from "./view.ts";
export { canvasExtension, canvasPlugin } from "./extension.ts";
export {
  CANVAS_PRESET_KINDS,
  CANVAS_SOLID_PRESETS,
  imageItem,
  makeItem,
  placedOnFace,
  presetItem,
} from "./presets.ts";
export {
  CANVAS_SHAPES,
  faceShare,
  topFace,
  faceStands,
  itemShape,
  onFootprint,
  outlinePoints,
  shapeOutline,
  svgPathData,
  topView,
  tracePath,
} from "./shapes.ts";
export type {
  TopFace,
  CanvasFootprint,
  CanvasPathCommand,
  CanvasPathSink,
  CanvasVolume,
} from "./shapes.ts";
export type { CanvasItemSpec, CanvasPresetKind } from "./presets.ts";
export type { CanvasCamera, CanvasPose, CanvasProjectionKind } from "./camera.ts";
export type {
  CanvasAnchor,
  CanvasDoc,
  CanvasEdge,
  CanvasHead,
  CanvasItemFlag,
  CanvasItemLink,
  CanvasRoute,
  CanvasFileNode,
  CanvasGroupNode,
  CanvasKbNode,
  CanvasNode,
  CanvasPathNode,
  CanvasShapeKind,
  CanvasShapeNode,
  CanvasSide,
  CanvasTextNode,
  KbLinkMode,
} from "./doc.ts";
