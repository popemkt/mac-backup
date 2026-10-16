import type { FailureCode } from "./failure.ts";
import { SYSTEM_IDS, type KbNode, type NodeId } from "./model.ts";
import { ScannedNodes } from "./node-graph.ts";

/** Resolve failures; codes are the FailureCodeSchema subset used by lookup/move. */
export type ResolveErrorCode = Extract<
  FailureCode,
  "not_found" | "ambiguous" | "invalid_move" | "forbidden"
>;

export class ResolveError extends Error {
  readonly code: ResolveErrorCode;
  readonly details?: unknown;

  constructor(code: ResolveErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ResolveError";
    this.code = code;
    this.details = details;
  }
}

/**
 * What name resolution asks of a graph: a node by id, and the nodes of one
 * type that carry one text. Every `NodeGraph` answers it; the array forms
 * ({@link resolveFieldId}) read it through `ScannedNodes`.
 */
export interface NamedNodes {
  get(id: NodeId): { readonly id: NodeId } | undefined;
  typedNamed(typeId: NodeId, text: string): readonly { readonly id: NodeId }[];
}

/**
 * Unique-text lookup among nodes typed as `sys.field` or `sys.tag`.
 * Accepts an id (sys.* or ULID) as a passthrough when it exists.
 */
function resolveNamed(graph: NamedNodes, nameOrId: string, kind: "field" | "tag"): NodeId {
  const typeId = kind === "field" ? SYSTEM_IDS.field : SYSTEM_IDS.tag;
  // An explicit id always wins, typed or not: `hasType` and the old sys.*
  // special case both fell through to the same answer, so neither ever
  // decided anything.
  const byId = graph.get(nameOrId);
  if (byId) return byId.id;

  const matches = graph.typedNamed(typeId, nameOrId);
  if (matches.length === 0) {
    throw new ResolveError("not_found", `${kind} not found: ${nameOrId}`, { nameOrId, kind });
  }
  if (matches.length > 1) {
    throw new ResolveError("ambiguous", `${kind} name is ambiguous: ${nameOrId}`, {
      nameOrId,
      kind,
      ids: matches.map((m) => m.id),
    });
  }
  const match = matches[0];
  if (match === undefined) {
    throw new ResolveError("not_found", `${kind} not found: ${nameOrId}`, { nameOrId, kind });
  }
  return match.id;
}

const FIELD_ID_ALIASES: Record<string, NodeId> = {
  type: SYSTEM_IDS.typeField,
  [SYSTEM_IDS.typeField]: SYSTEM_IDS.typeField,
  fields: SYSTEM_IDS.fieldsField,
  [SYSTEM_IDS.fieldsField]: SYSTEM_IDS.fieldsField,
  hidden: SYSTEM_IDS.hiddenField,
  [SYSTEM_IDS.hiddenField]: SYSTEM_IDS.hiddenField,
  fieldType: SYSTEM_IDS.fieldTypeField,
  [SYSTEM_IDS.fieldTypeField]: SYSTEM_IDS.fieldTypeField,
  targetTag: SYSTEM_IDS.targetTagField,
  [SYSTEM_IDS.targetTagField]: SYSTEM_IDS.targetTagField,
  targetQuery: SYSTEM_IDS.targetQueryField,
  [SYSTEM_IDS.targetQueryField]: SYSTEM_IDS.targetQueryField,
};

/** A field by name or id, in any graph that answers {@link NamedNodes}. */
export function resolveFieldIn(graph: NamedNodes, nameOrId: string): NodeId {
  const aliased = FIELD_ID_ALIASES[nameOrId];
  if (aliased !== undefined) return aliased;
  return resolveNamed(graph, nameOrId, "field");
}

/** A tag by name or id, in any graph that answers {@link NamedNodes}. */
export function resolveTagIn(graph: NamedNodes, nameOrId: string): NodeId {
  return resolveNamed(graph, nameOrId, "tag");
}

export function resolveFieldId(nodes: KbNode[], nameOrId: string): NodeId {
  return resolveFieldIn(new ScannedNodes(nodes), nameOrId);
}

export function resolveTagId(nodes: KbNode[], nameOrId: string): NodeId {
  return resolveTagIn(new ScannedNodes(nodes), nameOrId);
}
