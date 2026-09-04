// oxlint-disable-next-line typescript/triple-slash-reference -- datascript ships no types; the shim must travel with this module (see datascript.d.ts)
/// <reference path="./datascript.d.ts" />
import * as d from "datascript";
import { present, type NodeId } from "@kb/model";
import type { DatascriptDb, IdMap } from "./index/datoms.ts";
import { compile, normalizeEdnQuery } from "./ir/compile.ts";
import type { FindPos, Ir } from "./ir/ir.ts";
import { parseEdn } from "./ir/parse.ts";

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

function executeIr(exec: EdnExecutor, ir: Ir, inputs: readonly unknown[]): unknown {
  const compiled = compile(ir);
  const normalized = inputs.map(normalizeQueryInput);
  const extra = compiled.rules !== undefined ? [compiled.rules, ...normalized] : normalized;
  return exec(compiled.query, ...extra);
}

/**
 * Compile `ir`, run it through `exec`, revive **only** `node-ref` find positions.
 * Aggregate counts that collide with live eids stay numbers — the r4 red case.
 * Inputs (a `%` rules vector included) are normalised the same way `query` does.
 */
export function runIr(exec: EdnExecutor, ir: Ir, ids: IdMap, ...inputs: unknown[]): unknown {
  const raw = executeIr(exec, ir, inputs);
  if (ir.kind === "raw") return reviveValue(raw, ids);
  return reviveTyped(raw, ir.find, ids);
}

/**
 * Raw-EDN entry: `compile(parseEdn(edn))` then execute, then revive every
 * eid-shaped integer. Structured IR when the subset parses, `{ kind: "raw" }`
 * when it does not. Typed revival (aggregates stay numbers) lives on `runIr`.
 */
export function query(db: DatascriptDb, edn: string, ...inputs: unknown[]): unknown {
  const raw = executeIr(datascriptExecutor(db), parseEdn(edn), inputs);
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
