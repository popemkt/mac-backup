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
export function resolveNamed(nodes: KbNode[], nameOrId: string, kind: "field" | "tag"): NodeId {
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
  return matches[0]!.id;
}

export function resolveFieldId(nodes: KbNode[], nameOrId: string): NodeId {
  // system field ids resolve directly (short aliases + full sys.* ids)
  if (
    nameOrId === SYSTEM_IDS.typeField ||
    nameOrId === SYSTEM_IDS.fieldsField ||
    nameOrId === SYSTEM_IDS.hiddenField ||
    nameOrId === SYSTEM_IDS.fieldTypeField ||
    nameOrId === SYSTEM_IDS.targetTagField ||
    nameOrId === SYSTEM_IDS.targetQueryField ||
    nameOrId === "type" ||
    nameOrId === "fields" ||
    nameOrId === "hidden" ||
    nameOrId === "fieldType" ||
    nameOrId === "targetTag" ||
    nameOrId === "targetQuery"
  ) {
    if (nameOrId === "type" || nameOrId === SYSTEM_IDS.typeField) {
      return SYSTEM_IDS.typeField;
    }
    if (nameOrId === "fields" || nameOrId === SYSTEM_IDS.fieldsField) {
      return SYSTEM_IDS.fieldsField;
    }
    if (nameOrId === "hidden" || nameOrId === SYSTEM_IDS.hiddenField) {
      return SYSTEM_IDS.hiddenField;
    }
    if (nameOrId === "fieldType" || nameOrId === SYSTEM_IDS.fieldTypeField) {
      return SYSTEM_IDS.fieldTypeField;
    }
    if (nameOrId === "targetTag" || nameOrId === SYSTEM_IDS.targetTagField) {
      return SYSTEM_IDS.targetTagField;
    }
    if (nameOrId === "targetQuery" || nameOrId === SYSTEM_IDS.targetQueryField) {
      return SYSTEM_IDS.targetQueryField;
    }
  }
  return resolveNamed(nodes, nameOrId, "field");
}

export function resolveTagId(nodes: KbNode[], nameOrId: string): NodeId {
  return resolveNamed(nodes, nameOrId, "tag");
}
