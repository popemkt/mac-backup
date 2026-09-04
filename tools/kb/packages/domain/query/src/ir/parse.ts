import { present } from "@kb/model";
import type {
  Clause,
  FindPos,
  FindType,
  Ir,
  IrQuery,
  PatternClause,
  PullSpec,
  Term,
} from "./ir.ts";

type Src = { readonly s: string; i: number };

type Edn =
  | { k: "kw"; v: string }
  | { k: "sym"; v: string }
  | { k: "str"; v: string }
  | { k: "num"; v: number }
  | { k: "bool"; v: boolean }
  | { k: "vec"; v: Edn[] }
  | { k: "list"; v: Edn[] }
  | { k: "map"; v: [Edn, Edn][] };

class ParseFail extends Error {}

/**
 * Parse stored-form EDN into the kb IR. The subset is `:find` / `:in` / `:where`
 * over pattern clauses, rule calls, `count`/`collect`/`pull`, and the child
 * cartesian which collapses to `children`. Anything else is `{ kind: "raw" }`.
 */
export function parseEdn(edn: string): Ir {
  try {
    const src: Src = { s: edn, i: 0 };
    const value = readValue(src);
    skipWs(src);
    if (src.i !== src.s.length) return { kind: "raw", edn };
    const query = queryFromEdn(value);
    return query ?? { kind: "raw", edn };
  } catch {
    return { kind: "raw", edn };
  }
}

function skipWs(src: Src): void {
  while (src.i < src.s.length) {
    const c = src.s[src.i];
    if (c === ";") {
      while (src.i < src.s.length && src.s[src.i] !== "\n") src.i += 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === ",") {
      src.i += 1;
      continue;
    }
    break;
  }
}

function readValue(src: Src): Edn {
  skipWs(src);
  const c = src.s[src.i];
  if (c === undefined) throw new ParseFail("eof");
  if (c === '"') return { k: "str", v: readString(src) };
  if (c === ":") return { k: "kw", v: readKeyword(src) };
  if (c === "[") return { k: "vec", v: readSeq(src, "]") };
  if (c === "(") return { k: "list", v: readSeq(src, ")") };
  if (c === "{") return { k: "map", v: readMap(src) };
  if (c === "-" || (c >= "0" && c <= "9")) return { k: "num", v: readNumber(src) };
  return readSymbolOrBool(src);
}

function readString(src: Src): string {
  src.i += 1;
  let out = "";
  while (src.i < src.s.length) {
    const c = src.s[src.i];
    if (c === undefined) throw new ParseFail("unterminated string");
    if (c === '"') {
      src.i += 1;
      return out;
    }
    if (c === "\\") {
      src.i += 1;
      const e = src.s[src.i];
      if (e === undefined) throw new ParseFail("unterminated escape");
      out += e;
      src.i += 1;
      continue;
    }
    out += c;
    src.i += 1;
  }
  throw new ParseFail("unterminated string");
}

function readKeyword(src: Src): string {
  const start = src.i;
  src.i += 1;
  while (src.i < src.s.length && /[A-Za-z0-9_./+*-]/.test(present(src.s[src.i], "kw"))) {
    src.i += 1;
  }
  const kw = src.s.slice(start, src.i);
  if (kw.length < 2) throw new ParseFail("empty keyword");
  return kw;
}

function readNumber(src: Src): number {
  const start = src.i;
  if (src.s[src.i] === "-") src.i += 1;
  while (src.i < src.s.length && /[0-9.]/.test(present(src.s[src.i], "num"))) src.i += 1;
  const n = Number(src.s.slice(start, src.i));
  if (!Number.isFinite(n)) throw new ParseFail("bad number");
  return n;
}

function readSymbolOrBool(src: Src): Edn {
  const start = src.i;
  while (src.i < src.s.length && /[A-Za-z0-9_./+*?$%-]/.test(present(src.s[src.i], "sym"))) {
    src.i += 1;
  }
  const v = src.s.slice(start, src.i);
  if (v.length === 0) throw new ParseFail("empty symbol");
  if (v === "true") return { k: "bool", v: true };
  if (v === "false") return { k: "bool", v: false };
  return { k: "sym", v };
}

function readSeq(src: Src, close: "]" | ")"): Edn[] {
  src.i += 1;
  const out: Edn[] = [];
  for (;;) {
    skipWs(src);
    if (src.s[src.i] === close) {
      src.i += 1;
      return out;
    }
    out.push(readValue(src));
  }
}

function readMap(src: Src): [Edn, Edn][] {
  src.i += 1;
  const out: [Edn, Edn][] = [];
  for (;;) {
    skipWs(src);
    if (src.s[src.i] === "}") {
      src.i += 1;
      return out;
    }
    const key = readValue(src);
    const val = readValue(src);
    out.push([key, val]);
  }
}

function queryFromEdn(value: Edn): IrQuery | null {
  if (value.k !== "vec") return null;
  const sections = splitSections(value.v);
  if (sections === null) return null;
  const find = sections.find.map(findPosFromEdn);
  if (find.some((p) => p === null)) return null;
  const where = sections.where.map(clauseFromEdn);
  if (where.some((c) => c === null)) return null;
  const collapsed = collapseChildOrder(where.filter((c): c is Clause => c !== null));
  const typed = inferFindTypes(
    find.filter((p): p is FindPos => p !== null),
    collapsed,
  );
  const bound = boundVars(collapsed);
  const findOut = typed.filter((p) => p.kind !== "var" || bound.has(p.name));
  return {
    kind: "query",
    find: findOut,
    ...(sections.in !== undefined && sections.in.length > 0 ? { in: sections.in } : {}),
    where: collapsed,
  };
}

type Sections = { find: Edn[]; in?: string[]; where: Edn[] };

function sectionMode(kw: string): "find" | "in" | "where" | null {
  if (kw === ":find") return "find";
  if (kw === ":in") return "in";
  if (kw === ":where") return "where";
  return null;
}

function splitSections(items: Edn[]): Sections | null {
  let mode: "find" | "in" | "where" | null = null;
  const find: Edn[] = [];
  const inSlots: string[] = [];
  const where: Edn[] = [];
  for (const item of items) {
    if (item.k === "kw") {
      const next = sectionMode(item.v);
      if (next !== null) {
        mode = next;
        continue;
      }
      if (item.v === ":with" || item.v === ":keys" || item.v === ":limit" || item.v === ":rules") {
        return null;
      }
    }
    if (mode === "find") find.push(item);
    else if (mode === "in") {
      const slot = inSlot(item);
      if (slot === null) return null;
      if (slot !== "$") inSlots.push(slot);
    } else if (mode === "where") where.push(item);
    else return null;
  }
  if (find.length === 0 || where.length === 0) return null;
  return { find, in: inSlots.length > 0 ? inSlots : undefined, where };
}

function inSlot(item: Edn): string | null {
  if (item.k === "sym" && item.v === "$") return "$";
  if (item.k === "sym" && item.v === "%") return "%";
  if (item.k === "sym" && item.v.startsWith("?")) return item.v.slice(1);
  return null;
}

function findPosFromEdn(item: Edn): FindPos | null {
  if (item.k === "sym" && item.v.startsWith("?")) {
    return { kind: "var", name: item.v.slice(1), type: "scalar" };
  }
  if (item.k !== "list" || item.v.length < 2) return null;
  const [op, of, pattern] = item.v;
  if (op?.k !== "sym" || of?.k !== "sym" || !of.v.startsWith("?")) return null;
  const name = of.v.slice(1);
  if (op.v === "count" || op.v === "collect") {
    return { kind: "aggregate", op: op.v, of: name, type: "aggregate" };
  }
  if (op.v === "pull" && pattern !== undefined) {
    const pull = pullFromEdn(pattern);
    if (pull === null) return null;
    return { kind: "pull", of: name, pattern: pull, type: "node-ref" };
  }
  return null;
}

function pullFromEdn(item: Edn): PullSpec | null {
  if (item.k === "vec") {
    const out: PullSpec = [];
    for (const el of item.v) {
      const one = pullElem(el);
      if (one === null) return null;
      out.push(one);
    }
    return out;
  }
  return null;
}

function pullElem(el: Edn): PullSpec[number] | null {
  if (el.k === "kw") return el.v;
  if (el.k !== "map") return null;
  const rec: { [attr: string]: PullSpec } = {};
  for (const [k, v] of el.v) {
    if (k.k !== "kw") return null;
    const nested = pullFromEdn(v);
    if (nested === null) return null;
    rec[k.v] = nested;
  }
  return rec;
}

function clauseFromEdn(item: Edn): Clause | null {
  if (item.k === "vec") return patternFromEdn(item.v);
  if (item.k === "list") return ruleFromEdn(item.v);
  return null;
}

function patternFromEdn(parts: Edn[]): PatternClause | null {
  if (parts.length !== 3) return null;
  const [e, a, v] = parts;
  if (e?.k !== "sym" || !e.v.startsWith("?")) return null;
  if (a?.k !== "kw") return null;
  const value = termFromEdn(v);
  if (value === null) return null;
  return { kind: "pattern", entity: e.v.slice(1), attr: a.v, value };
}

function ruleFromEdn(parts: Edn[]): Clause | null {
  const [name, ...args] = parts;
  if (name?.k !== "sym" || name.v.startsWith("?")) return null;
  const terms: Term[] = [];
  for (const a of args) {
    const t = termFromEdn(a);
    if (t === null) return null;
    terms.push(t);
  }
  return { kind: "rule", name: name.v, args: terms };
}

function termFromEdn(item: Edn | undefined): Term | null {
  if (item === undefined) return null;
  if (item.k === "sym" && item.v.startsWith("?")) return { t: "var", name: item.v.slice(1) };
  if (item.k === "str") return { t: "str", value: item.v };
  if (item.k === "num") return { t: "num", value: item.v };
  if (item.k === "bool") return { t: "bool", value: item.v };
  return null;
}

function collapseChildOrder(where: Clause[]): Clause[] {
  const childByParent = new Map<string, string>();
  const orderParents = new Set<string>();
  for (const c of where) {
    if (c.kind !== "pattern" || c.value.t !== "var") continue;
    if (c.attr === ":node/child") childByParent.set(c.entity, c.value.name);
    if (c.attr === ":node/child-order") orderParents.add(c.entity);
  }
  const out: Clause[] = [];
  const emitted = new Set<string>();
  for (const c of where) {
    if (c.kind === "pattern" && c.value.t === "var" && orderParents.has(c.entity)) {
      if (c.attr === ":node/child-order") continue;
      if (c.attr === ":node/child") {
        if (!emitted.has(c.entity)) {
          out.push({
            kind: "children",
            parent: c.entity,
            child: present(childByParent.get(c.entity), "child var"),
          });
          emitted.add(c.entity);
        }
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

const REF_ATTRS = new Set([":node/id", ":node/child", ":node/mentions", ":node/children"]);

function inferFindTypes(find: FindPos[], where: Clause[]): FindPos[] {
  const nodeRefs = collectNodeRefVars(where);
  return find.map((pos) => {
    if (pos.kind !== "var") return pos;
    const type: FindType = nodeRefs.has(pos.name) ? "node-ref" : "scalar";
    return { kind: "var", name: pos.name, type };
  });
}

function collectNodeRefVars(where: Clause[]): Set<string> {
  const nodeRefs = new Set<string>();
  const scalars = new Set<string>();
  for (const c of where) {
    if (c.kind === "pattern") {
      nodeRefs.add(c.entity);
      if (c.value.t === "var") {
        if (REF_ATTRS.has(c.attr)) nodeRefs.add(c.value.name);
        else scalars.add(c.value.name);
      }
    } else if (c.kind === "children") {
      nodeRefs.add(c.parent);
      nodeRefs.add(c.child);
    } else if (c.kind === "reach") {
      nodeRefs.add(c.from);
      nodeRefs.add(c.to);
    }
  }
  for (const c of where) {
    if (c.kind !== "rule") continue;
    for (const a of c.args) {
      if (a.t === "var" && !scalars.has(a.name)) nodeRefs.add(a.name);
    }
  }
  return nodeRefs;
}

function boundVars(where: Clause[]): Set<string> {
  const bound = new Set<string>();
  for (const c of where) {
    if (c.kind === "pattern") {
      bound.add(c.entity);
      if (c.value.t === "var") bound.add(c.value.name);
    } else if (c.kind === "children") {
      bound.add(c.parent);
      bound.add(c.child);
    } else if (c.kind === "reach") {
      bound.add(c.from);
      bound.add(c.to);
    } else {
      for (const a of c.args) {
        if (a.t === "var") bound.add(a.name);
      }
    }
  }
  return bound;
}
