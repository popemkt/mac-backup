export { byNodeId, canonicalJson, canonicalJsonl } from "./canonical.ts";
export {
  DomainError,
  domainError,
  domainFromResolve,
  ensureDomainError,
  isDomainError,
  receiptCodeOf,
} from "./errors.ts";
export { mergeNodeSets } from "./merge.ts";
export type { MergeConflict, MergeConflictReason, MergeResult } from "./merge.ts";
export { present } from "./present.ts";
export { exampleSeedNodes, isPristine } from "./example.ts";
export { FailureCodeSchema } from "./failure.ts";
export type { CodedError, FailureCode } from "./failure.ts";
export {
  FIELD_TYPES,
  FIELD_TYPE_OPTION_IDS,
  acceptsValueKind,
  allowedRefIdsOf,
  cardinalityOf,
  childrenTargetQuery,
  declaresOptionSet,
  fieldTypeOf,
  fieldTypeValue,
  isFieldType,
  migrateFieldTypeValues,
  targetQueryOf,
  targetTagsOf,
} from "./field-type.ts";
export type { Cardinality, FieldType } from "./field-type.ts";
export { conformsToType, migrateDateValues, normalizeUrl, parseTypedValue } from "./field-value.ts";
export type { NumberSeparators, ParseContext, ParsedValue } from "./field-value.ts";
export {
  addDays,
  addMonths,
  dayNumber,
  formatDay,
  parseDateInput,
  parseDay,
  weekday,
} from "./local-date.ts";
export type { LocalDate } from "./local-date.ts";
export { SYSTEM_IDS, currentIso, freshId, isSysPrefixed, nowIso } from "./model.ts";
export type { KbNode, NodeId, PropValue } from "./model.ts";
export {
  allValues,
  decodeNodeConfig,
  encodeNodeConfig,
  encodeNodeSetting,
  firstBool,
  firstNum,
  firstRef,
  firstStr,
  manyOf,
  oneOf,
  writeBool,
  writeNum,
  writeRef,
  writeStr,
} from "./node-config.ts";
export type {
  ConfigReader,
  ConfigSlot,
  ConfigSlots,
  NodeProps,
  SlotWrite,
  Writable,
} from "./node-config.ts";
export {
  KbNodeSchema,
  PropValueSchema,
  decodeStoredNode,
  decodeStoredTx,
  nodeParseOptions,
} from "./node-schema.ts";
export {
  DEFAULT_MAX_DEPTH,
  LIST_ONTOLOGIES_QUERY,
  ONTOLOGY_TARGET_QUERY,
  describeReason,
  isOntologyNode,
  listOntologyNodes,
  ontologyClosureMode,
  refValuesOf,
  resolveOntology,
  strValueOf,
  typeRefsOf,
  wouldCreateExtendsCycle,
} from "./ontology.ts";
export type { MemberReason, NodeLike, OntologyResolution } from "./ontology.ts";
export {
  compareRootOrder,
  rankBetween,
  rankForInsert,
  rankOf,
  rankTx,
  siblingSlots,
} from "./order.ts";
export type { NodeRank, RankSlot } from "./order.ts";
export { ResolveError, resolveFieldId, resolveTagId } from "./resolve.ts";
export {
  ActionSchemaError,
  isActionSchema,
  isStandardSchemaV1,
  isZodError,
  parseBySchema,
  schemaFailure,
  schemaToJsonSchema,
} from "./schema-seam.ts";
export type { ActionSchema } from "./schema-seam.ts";
export { ensureSystemSeed, systemSeedNodes } from "./seed.ts";
export { applyTx, diffTx, txIntegrityError } from "./tx.ts";
export type { KbTx, StoreTx } from "./tx.ts";

export {
  GRAPH_THEME_VALUES,
  GRAPH_LINK_STYLE_VALUES,
  graphOptionKey,
  graphOptionId,
  GRAPH_SOURCE_FIELD_KINDS,
  GRAPH_SOURCE_KINDS,
  GRAPH_SOURCE_KIND_OPTION_IDS,
  GRAPH_SOURCE_VALUES,
  graphSourceKey,
  graphSourceId,
  graphSourceTargetQuery,
} from "./graph-schema.ts";
export type { GraphSourceField, GraphSourceKind } from "./graph-schema.ts";
export {
  DOCS_VIEW_OPTION,
  VIEW_FAMILY_VALUES,
  VIEW_NODE_TARGET_QUERY,
  VIEW_OPTION_TARGET_QUERY,
  VIEW_VALUES,
  defaultViewIdOf,
  familyViewIdOf,
  docsViewNameError,
  docsViewNameOf,
  isDocsView,
  viewsWithDefault,
  docsViewProps,
  familyViewNodesQuery,
  hostViewIds,
  isViewNode,
  viewFamilyTargetQuery,
  viewIdOfOption,
  viewOptionId,
  viewOptionOf,
  viewValueEntries,
} from "./view-node.ts";
export type { DocsViewSpec, ViewFamily, ViewId } from "./view-node.ts";
export {
  LEGACY_PERSPECTIVE_TAG,
  LEGACY_VIEW_MODE_FIELD,
  docsViewNodeId,
  frameViewNodeId,
  legacyViewShapes,
  migrateToViewNodes,
} from "./view-migration.ts";
export type { LegacyDocsView, LegacyViews, ViewMigration } from "./view-migration.ts";
export { isValidWorkspaceName } from "./workspace-name.ts";
