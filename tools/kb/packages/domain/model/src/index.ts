export { canonicalJson, canonicalJsonl } from "./canonical.ts";
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
  allowedRefIdsOf,
  childrenTargetQuery,
  fieldTypeOf,
  fieldTypeValue,
  isFieldType,
  migrateFieldTypeValues,
  targetQueryOf,
  targetTagsOf,
} from "./field-type.ts";
export type { FieldType } from "./field-type.ts";
export { SYSTEM_IDS, currentIso, freshId, isSysPrefixed, nowIso } from "./model.ts";
export type { KbNode, NodeId, PropValue } from "./model.ts";
export {
  KbNodeSchema,
  PropValueSchema,
  decodeStoredNode,
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
export { migrateOrderKeys, rankBetween } from "./order.ts";
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
export { diffTx, txIntegrityError } from "./tx.ts";
export type { KbTx, StoreTx } from "./tx.ts";

export {
  GRAPH_RENDERER_VALUES,
  GRAPH_SOURCE_VALUES,
  graphSourceKey,
  graphSourceId,
  graphRendererKey,
  graphRendererId,
} from "./graph-schema.ts";
export type { GraphSourceKind } from "./graph-schema.ts";
