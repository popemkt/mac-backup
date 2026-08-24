import type { ActionInvocation } from "../shared/contracts.ts";
import { isValidSavedQueryName } from "../foundation/saved-query.ts";
import {
  LIST_FIELDS_QUERY,
  LIST_TAGS_QUERY,
  backlinksQuery,
} from "../foundation/query/queries.ts";
import {
  FIELD_TYPES,
  fieldTypeValue,
  isFieldType,
} from "../foundation/field-type.ts";
import { SYSTEM_IDS, type PropValue } from "../foundation/model.ts";
import { LIST_ONTOLOGIES_QUERY } from "../foundation/ontology.ts";

export type PropType = "str" | "num" | "bool" | "date" | "ref";

export interface PlannedAction {
  id: string;
  input: unknown;
}

/** Infer PropValue from a CLI string (optional explicit type). */
export function parsePropValue(
  raw: string,
  type?: PropType,
): { t: PropType; v: string | number | boolean } {
  if (type === "str") return { t: "str", v: raw };
  if (type === "num") return { t: "num", v: Number(raw) };
  if (type === "bool") return { t: "bool", v: raw === "true" || raw === "1" };
  if (type === "date") return { t: "date", v: raw };
  if (type === "ref") return { t: "ref", v: raw };

  if (raw === "true" || raw === "false") return { t: "bool", v: raw === "true" };
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { t: "num", v: Number(raw) };
  return { t: "str", v: raw };
}

/** Parse `field=value` or `field:type=value` fragments. */
export function parsePropArg(arg: string): {
  field: string;
  value: { t: PropType; v: string | number | boolean };
} {
  const eq = arg.indexOf("=");
  if (eq <= 0) {
    throw new UsageError(`invalid --prop (expected field=value): ${arg}`);
  }
  const left = arg.slice(0, eq);
  const raw = arg.slice(eq + 1);
  const colon = left.lastIndexOf(":");
  if (colon > 0) {
    const field = left.slice(0, colon);
    const type = left.slice(colon + 1) as PropType;
    if (!["str", "num", "bool", "date", "ref"].includes(type)) {
      throw new UsageError(`invalid prop type: ${type}`);
    }
    return { field, value: parsePropValue(raw, type) };
  }
  return { field: left, value: parsePropValue(raw) };
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function mapInit(): PlannedAction[] {
  // init is openKb/seed — no registry action; empty plan signals side-effect only
  return [];
}

export function mapAdd(opts: {
  text: string;
  parent?: string;
  position?: number;
  tags?: string[];
  props?: string[];
  id?: string;
  force?: boolean;
}): PlannedAction {
  const props = (opts.props ?? []).map(parsePropArg);
  return {
    id: "node.add",
    input: {
      text: opts.text,
      ...(opts.parent !== undefined ? { parent: opts.parent } : {}),
      ...(opts.position !== undefined ? { position: opts.position } : {}),
      ...(opts.tags && opts.tags.length > 0 ? { tags: opts.tags } : {}),
      ...(props.length > 0 ? { props } : {}),
      ...(opts.id !== undefined ? { id: opts.id } : {}),
      ...(opts.force === true ? { force: true } : {}),
    },
  };
}

export function mapSet(opts: {
  id: string;
  field: string;
  value: string;
  type?: PropType;
  force?: boolean;
}): PlannedAction {
  return {
    id: "node.update",
    input: {
      id: opts.id,
      setProps: [
        { field: opts.field, value: parsePropValue(opts.value, opts.type) },
      ],
      ...(opts.force === true ? { force: true } : {}),
    },
  };
}

export function mapUnset(opts: {
  id: string;
  field: string;
  value?: string;
  type?: PropType;
  force?: boolean;
}): PlannedAction {
  const entry: { field: string; value?: unknown } = { field: opts.field };
  if (opts.value !== undefined) {
    entry.value = parsePropValue(opts.value, opts.type);
  }
  return {
    id: "node.update",
    input: {
      id: opts.id,
      unsetProps: [entry],
      ...(opts.force === true ? { force: true } : {}),
    },
  };
}

export function mapGet(opts: { id: string; depth?: number }): PlannedAction {
  return {
    id: "node.get",
    input: { id: opts.id, depth: opts.depth ?? 1 },
  };
}

export function mapRm(opts: { id: string; force?: boolean }): PlannedAction {
  return {
    id: "node.update",
    input: {
      id: opts.id,
      delete: true,
      ...(opts.force === true ? { force: true } : {}),
    },
  };
}

export function mapMv(opts: {
  id: string;
  parent: string | null;
  position?: number;
  force?: boolean;
}): PlannedAction {
  return {
    id: "node.update",
    input: {
      id: opts.id,
      parent: opts.parent,
      ...(opts.position !== undefined ? { position: opts.position } : {}),
      ...(opts.force === true ? { force: true } : {}),
    },
  };
}

export function mapFieldDefine(opts: {
  name: string;
  id?: string;
}): PlannedAction {
  return {
    id: "field.define",
    input: {
      name: opts.name,
      ...(opts.id !== undefined ? { id: opts.id } : {}),
    },
  };
}

export function mapTagDefine(opts: {
  name: string;
  id?: string;
  fields?: string[];
}): PlannedAction {
  return {
    id: "tag.define",
    input: {
      name: opts.name,
      ...(opts.id !== undefined ? { id: opts.id } : {}),
      ...(opts.fields && opts.fields.length > 0 ? { fields: opts.fields } : {}),
    },
  };
}

export function mapFieldList(): PlannedAction {
  return {
    id: "graph.query",
    input: {
      query: LIST_FIELDS_QUERY,
    },
  };
}


/**
 * Replace sys.f.fieldType (caller must resolve field id + pass prior value to
 * unset). The written value is a ref to the type's option node — field types
 * are nodes, and the accepted names come from that one mapping rather than an
 * enum kept in step by hand.
 */
export function mapFieldType(opts: {
  fieldId: string;
  type: string;
  previous?: PropValue;
}): PlannedAction {
  if (!isFieldType(opts.type)) {
    throw new UsageError(
      `invalid field type: ${opts.type} (expected ${FIELD_TYPES.join("|")})`,
    );
  }
  return {
    id: "node.update",
    input: {
      id: opts.fieldId,
      ...(opts.previous
        ? {
            unsetProps: [
              { field: SYSTEM_IDS.fieldTypeField, value: opts.previous },
            ],
          }
        : {}),
      setProps: [
        {
          field: SYSTEM_IDS.fieldTypeField,
          value: fieldTypeValue(opts.type),
        },
      ],
    },
  };
}

export function mapFieldTarget(opts: {
  fieldId: string;
  tagId: string;
}): PlannedAction {
  return {
    id: "node.update",
    input: {
      id: opts.fieldId,
      setProps: [
        { field: "sys.f.targetTag", value: { t: "ref", v: opts.tagId } },
      ],
    },
  };
}

export function mapFieldTargetQuery(opts: {
  fieldId: string;
  edn: string;
  previous?: { t: "str"; v: string };
}): PlannedAction {
  return {
    id: "node.update",
    input: {
      id: opts.fieldId,
      ...(opts.previous
        ? {
            unsetProps: [
              { field: "sys.f.targetQuery", value: opts.previous },
            ],
          }
        : {}),
      setProps: [
        {
          field: "sys.f.targetQuery",
          value: { t: "str", v: opts.edn },
        },
      ],
    },
  };
}

export function mapTagList(): PlannedAction {
  return {
    id: "graph.query",
    input: {
      query: LIST_TAGS_QUERY,
    },
  };
}

/** All `#ontology` nodes (id + text). */
export function mapOntologyList(): PlannedAction {
  return {
    id: "graph.query",
    input: {
      query: LIST_ONTOLOGIES_QUERY,
    },
  };
}

/** Resolve one ontology's membership, optionally with provenance. */
export function mapOntologyMembers(opts: {
  id: string;
  reasons?: boolean;
}): PlannedAction {
  return {
    id: "ontology.members",
    input: {
      id: opts.id,
      ...(opts.reasons === true ? { reasons: true } : {}),
    },
  };
}

export function mapQuery(opts: {
  query: string;
  inputs?: unknown[];
}): PlannedAction {
  return {
    id: "graph.query",
    input: {
      query: opts.query,
      ...(opts.inputs ? { inputs: opts.inputs } : {}),
    },
  };
}

/**
 * Saved-query run: the action owns name validation + `.kb/queries/<name>.edn`
 * resolution + execution. The CLI keeps only the argv-shape check (a name that
 * can never resolve is a usage error, exit 2); the file read is not CLI policy.
 */
export function mapRun(name: string): PlannedAction {
  if (!isValidSavedQueryName(name)) {
    throw new UsageError(
      `invalid saved query name: ${name} (letters, digits, ., _, - only)`,
    );
  }
  return {
    id: "graph.run",
    input: { name },
  };
}

export function mapSearch(text: string): PlannedAction {
  return {
    id: "graph.search",
    input: { text },
  };
}

export function mapBacklinks(id: string): PlannedAction {
  return {
    id: "graph.query",
    input: {
      query: backlinksQuery(id),
    },
  };
}

export function mapChildren(id: string): PlannedAction {
  return {
    id: "node.get",
    input: { id, depth: 1 },
  };
}

export function mapActionInvoke(raw: unknown): ActionInvocation {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("id" in raw) ||
    typeof (raw as { id: unknown }).id !== "string"
  ) {
    throw new UsageError(
      'action-invoke expects JSON object with string "id" and optional "input"',
    );
  }
  const obj = raw as { id: string; input?: unknown };
  return { id: obj.id, input: obj.input ?? {} };
}

/** Fields referenced by a planned apply that may need --create minting. */
export function fieldsNeedingCreate(plan: PlannedAction): string[] {
  const input = plan.input as Record<string, unknown> | null;
  if (!input || typeof input !== "object") return [];
  const names: string[] = [];
  if (Array.isArray(input.props)) {
    for (const p of input.props) {
      if (p && typeof p === "object" && "field" in p) {
        names.push(String((p as { field: string }).field));
      }
    }
  }
  if (Array.isArray(input.setProps)) {
    for (const p of input.setProps) {
      if (p && typeof p === "object" && "field" in p) {
        names.push(String((p as { field: string }).field));
      }
    }
  }
  return names;
}
