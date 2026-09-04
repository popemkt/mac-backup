// oxlint-disable-next-line typescript/triple-slash-reference -- datascript ships no types; the shim must travel with this module (see datascript.d.ts)
/// <reference path="./datascript.d.ts" />
import * as d from "datascript";
import { present, type NodeId } from "@kb/model";
import type { DatascriptDb, IdMap } from "./index/datoms.ts";
import { compile, normalizeEdnQuery } from "./ir/compile.ts";
import type { FindPos, Ir } from "./ir/ir.ts";

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

function reviveTyped(raw: unknown, find: readonly FindPos[], ids: IdMap): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((row) => reviveTypedRow(row, find, ids));
}

function reviveTypedRow(row: unknown, find: readonly FindPos[], ids: IdMap): unknown {
  if (!Array.isArray(row)) return row;
  return row.map((val, i) => {
    const pos = find[i];
    if (pos?.type === "node-ref") return reviveValue(val, ids);
    return val;
  });
}

function executeEdn(db: DatascriptDb, edn: string, ...inputs: unknown[]): unknown {
  try {
    return d.q(edn, db.db, ...inputs);
  } catch (err) {
    throw new DatalogError(err instanceof Error ? err.message : String(err));
  }
}

/** `(edn, ...inputs) => raw rows` — no revival. `runIr` supplies typed revival. */
export type EdnExecutor = (edn: string, ...inputs: unknown[]) => unknown;

export function datascriptExecutor(db: DatascriptDb): EdnExecutor {
  return (edn, ...inputs) => executeEdn(db, edn, ...inputs);
}

/**
 * Compile `ir`, run it through `exec`, revive **only** `node-ref` find positions.
 * Aggregate counts that collide with live eids stay numbers — the r4 red case.
 */
export function runIr(exec: EdnExecutor, ir: Ir, ids: IdMap, ...inputs: unknown[]): unknown {
  const compiled = compile(ir);
  const extra = compiled.rules !== undefined ? [compiled.rules, ...inputs] : inputs;
  const raw = exec(compiled.query, ...extra);
  if (ir.kind === "raw") return reviveValue(raw, ids);
  return reviveTyped(raw, ir.find, ids);
}

/**
 * Run raw EDN datalog; entity ids in results are revived to NodeIds when known.
 *
 * This is the engine-specific surface: every integer that matches a live eid
 * is revived, including aggregate counts that happen to collide. String
 * inputs (rules vectors included) are normalised the same way as the query.
 * Typed revival lives on `runIr`.
 */
export function query(db: DatascriptDb, edn: string, ...inputs: unknown[]): unknown {
  const q = normalizeEdnQuery(rewriteChildOrderCartesian(edn));
  const raw = executeEdn(db, q, ...inputs.map(normalizeQueryInput));
  return reviveValue(raw, db.ids);
}

/**
 * `:find` results as rows. `query` returns `unknown` because a datalog result
 * is whatever the query asked for; every row-shaped caller went through the
 * same cast, so the check lives here instead.
 */
export function queryRows(db: DatascriptDb, edn: string, ...inputs: unknown[]): unknown[][] {
  const raw = query(db, edn, ...inputs);
  if (!Array.isArray(raw) || !raw.every((row) => Array.isArray(row))) {
    throw new DatalogError(`datalog query did not return rows: ${edn}`);
  }
  return raw;
}

export function pull(db: DatascriptDb, pattern: string, id: NodeId | number): unknown {
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
