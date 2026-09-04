import type { FailureCode } from "./failure.ts";
import { SYSTEM_IDS, type KbNode, type NodeId } from "./model.ts";
import { typeRefsOf } from "./ontology.ts";

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

function hasType(node: KbNode, typeId: NodeId): boolean {
  return typeRefsOf(node).includes(typeId);
}

/**
 * Unique-text lookup among nodes typed as `sys.field` or `sys.tag`.
 * Accepts an id (sys.* or ULID) as a passthrough when it exists.
 */
function resolveNamed(nodes: KbNode[], nameOrId: string, kind: "field" | "tag"): NodeId {
  const typeId = kind === "field" ? SYSTEM_IDS.field : SYSTEM_IDS.tag;
  // An explicit id always wins, typed or not: `hasType` and the old sys.*
  // special case both fell through to the same answer, so neither ever
  // decided anything.
  const byId = nodes.find((n) => n.id === nameOrId);
  if (byId) return byId.id;

  const matches = nodes.filter((n) => n.text === nameOrId && hasType(n, typeId));
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

export function resolveFieldId(nodes: KbNode[], nameOrId: string): NodeId {
  const aliased = FIELD_ID_ALIASES[nameOrId];
  if (aliased !== undefined) return aliased;
  return resolveNamed(nodes, nameOrId, "field");
}

export function resolveTagId(nodes: KbNode[], nameOrId: string): NodeId {
  return resolveNamed(nodes, nameOrId, "tag");
}
