import { SYSTEM_IDS, type KbNode, type NodeId } from "./model.ts";

export class ResolveError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "ambiguous"
      | "invalid_move"
      | "forbidden",
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ResolveError";
  }
}

function hasType(node: KbNode, typeId: NodeId): boolean {
  const vals = node.props[SYSTEM_IDS.typeField] ?? [];
  return vals.some((v) => v.t === "ref" && v.v === typeId);
}

/**
 * Unique-text lookup among nodes typed as `sys.field` or `sys.tag`.
 * Accepts an id (sys.* or ULID) as a passthrough when it exists.
 */
export function resolveNamed(
  nodes: KbNode[],
  nameOrId: string,
  kind: "field" | "tag",
): NodeId {
  const typeId = kind === "field" ? SYSTEM_IDS.field : SYSTEM_IDS.tag;
  const byId = nodes.find((n) => n.id === nameOrId);
  if (byId) {
    if (hasType(byId, typeId) || nameOrId.startsWith("sys.")) return byId.id;
    // raw id hit that isn't typed — still accept explicit id
    return byId.id;
  }

  const matches = nodes.filter(
    (n) => n.text === nameOrId && hasType(n, typeId),
  );
  if (matches.length === 0) {
    throw new ResolveError(
      "not_found",
      `${kind} not found: ${nameOrId}`,
      { nameOrId, kind },
    );
  }
  if (matches.length > 1) {
    throw new ResolveError(
      "ambiguous",
      `${kind} name is ambiguous: ${nameOrId}`,
      { nameOrId, kind, ids: matches.map((m) => m.id) },
    );
  }
  return matches[0]!.id;
}

export function resolveFieldId(nodes: KbNode[], nameOrId: string): NodeId {
  // system field ids resolve directly
  if (
    nameOrId === SYSTEM_IDS.typeField ||
    nameOrId === SYSTEM_IDS.fieldsField ||
    nameOrId === SYSTEM_IDS.hiddenField ||
    nameOrId === "type" ||
    nameOrId === "fields" ||
    nameOrId === "hidden"
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
  }
  return resolveNamed(nodes, nameOrId, "field");
}

export function resolveTagId(nodes: KbNode[], nameOrId: string): NodeId {
  return resolveNamed(nodes, nameOrId, "tag");
}
