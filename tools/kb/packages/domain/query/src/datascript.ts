// oxlint-disable-next-line typescript/triple-slash-reference -- datascript ships no types; the shim must travel with this module (see datascript.d.ts)
/// <reference path="./datascript.d.ts" />
import * as d from "datascript";
import { present, type NodeId } from "@kb/model";
import type { IdMap, QueryDb } from "./index/datoms.ts";

/**
 * A query that failed inside the datascript engine — parse or evaluation
 * error in the user-supplied EDN. Distinguishes "the datalog is wrong"
 * (invalid_input at the action boundary) from internal glue failures
 * (normalization / revive bugs, which stay plain `Error` → internal).
 */
export class DatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatalogError";
  }
}

const QUERY_DIRECTIVES = new Set([
  "find",
  "where",
  "in",
  "with",
  "keys",
  "limit",
  "offset",
  "rules",
]);

/**
 * DataScript JS API stores attrs as strings; EDN queries use keywords.
 * Rewrite `:attr` → `":attr"` (quoted) except query directives.
 *
 * Rules vectors (`:in $ %`) are the same dialect and must go through this
 * too — an unquoted `:f/…` inside a rule stays a keyword while datoms hold
 * strings, and DataScript throws mid-fixpoint.
 */
export function normalizeEdnQuery(edn: string): string {
  const keyword = /^:([A-Za-z*][\w./+*-]*)/;
  let out = "";
  let i = 0;
  while (i < edn.length) {
    if (edn[i] === '"') {
      let j = i + 1;
      while (j < edn.length) {
        if (edn[j] === "\\") j += 2;
        else if (edn[j] === '"') {
          j += 1;
          break;
        } else j += 1;
      }
      out += edn.slice(i, j);
      i = j;
      continue;
    }
    const m = keyword.exec(edn.slice(i));
    if (m) {
      const directive = present(m[1], "edn keyword");
      out += QUERY_DIRECTIVES.has(directive) ? m[0] : `"${m[0]}"`;
      i += m[0].length;
      continue;
    }
    out += edn[i];
    i += 1;
  }
  return out;
}

/**
 * `[?p :node/child ?c] [?p :node/child-order ?ord]` is a cartesian product:
 * both attrs are cardinality-many on the parent, so N children × N orders
 * rows. The child *set* is `:node/child` alone; order lives on the
 * `:node/children` vector. Drop the unusable join.
 */
function rewriteChildOrderCartesian(edn: string): string {
  const childClause = /\[\s*(\?\S+)\s+:node\/child\s+\?\S+\s*\]/g;
  const childEntities = new Set<string>();
  for (const m of edn.matchAll(childClause)) {
    childEntities.add(present(m[1], "child-clause entity"));
  }
  if (childEntities.size === 0) return edn;

  const droppedOrd: string[] = [];
  const orderClause = /\[\s*(\?\S+)\s+:node\/child-order\s+(\?\S+)\s*\]/g;
  const withoutOrder = edn.replace(orderClause, (full, entity: string, ord: string) => {
    if (!childEntities.has(entity)) return full;
    droppedOrd.push(ord);
    return "";
  });
  return dropUnusedFindVars(withoutOrder, droppedOrd);
}

function dropUnusedFindVars(edn: string, vars: readonly string[]): string {
  let out = edn;
  for (const v of vars) {
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const occurrences = out.match(new RegExp(escaped, "g"));
    if (occurrences !== null && occurrences.length === 1) {
      out = out.replace(new RegExp(`\\s*${escaped}\\b`), "");
    }
  }
  return out;
}

function normalizeQueryInput(input: unknown): unknown {
  if (typeof input === "string") return normalizeEdnQuery(input);
  if (Array.isArray(input)) return input.map(normalizeQueryInput);
  return input;
}

function reviveValue(v: unknown, ids: IdMap): unknown {
  if (typeof v === "number" && ids.toId.has(v)) return ids.toId.get(v);
  if (Array.isArray(v)) return v.map((x) => reviveValue(x, ids));
  return v;
}

/**
 * Run raw EDN datalog; entity ids in results are revived to NodeIds when known.
 *
 * This is the engine-specific surface: every integer that matches a live eid
 * is revived, including aggregate counts that happen to collide. String
 * inputs (rules vectors included) are normalised the same way as the query.
 */
export function query(db: QueryDb, edn: string, ...inputs: unknown[]): unknown {
  const q = normalizeEdnQuery(rewriteChildOrderCartesian(edn));
  const normalizedInputs = inputs.map(normalizeQueryInput);
  let raw: unknown;
  try {
    raw = d.q(q, db.db, ...normalizedInputs);
  } catch (err) {
    // Query parse/evaluation failures are the caller's datalog at fault, not
    // an internal defect — surface them as DatalogError so action surfaces can
    // type them invalid_input while genuine glue bugs stay plain Error.
    throw new DatalogError(err instanceof Error ? err.message : String(err));
  }
  return reviveValue(raw, db.ids);
}

/**
 * `:find` results as rows. `query` returns `unknown` because a datalog result
 * is whatever the query asked for; every row-shaped caller went through the
 * same cast, so the check lives here instead.
 */
export function queryRows(db: QueryDb, edn: string, ...inputs: unknown[]): unknown[][] {
  const raw = query(db, edn, ...inputs);
  if (!Array.isArray(raw) || !raw.every((row) => Array.isArray(row))) {
    throw new DatalogError(`datalog query did not return rows: ${edn}`);
  }
  return raw;
}

export function pull(db: QueryDb, pattern: string, id: NodeId | number): unknown {
  let eidOrLookup: number | [string, string];
  if (typeof id === "number") {
    eidOrLookup = id;
  } else if (db.ids.toEid.has(id)) {
    eidOrLookup = present(db.ids.toEid.get(id), `eid for ${id}`);
  } else {
    eidOrLookup = [":node/id", id];
  }
  const pat = normalizeEdnQuery(pattern);
  const raw = d.pull(db.db, pat, eidOrLookup);
  return revivePull(raw, db.ids);
}

function revivePull(raw: unknown, ids: IdMap): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== "object") return reviveValue(raw, ids);
  if (Array.isArray(raw)) return raw.map((x) => revivePull(x, ids));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === ":db/id" && typeof v === "number") {
      out[k] = v;
      const nid = ids.toId.get(v);
      if (nid !== undefined) out[":node/id"] = nid;
      continue;
    }
    out[k] = revivePull(v, ids);
  }
  return out;
}
