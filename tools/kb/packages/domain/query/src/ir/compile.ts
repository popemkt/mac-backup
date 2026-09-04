import { present } from "@kb/model";
import type { Clause, FindPos, Ir, PullSpec, ReachClause, Term } from "./ir.ts";

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
 * One home: the compiler. `query()` and `runIr` both go through this.
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

type CompiledEdn = { query: string; rules?: string };

/**
 * Compile IR to DataScript EDN. `raw` passes through (still normalised).
 * `reach` becomes a recursive `%` rule; `children` projects `:node/children`.
 */
export function compile(ir: Ir): CompiledEdn {
  if (ir.kind === "raw") return { query: normalizeEdnQuery(ir.edn) };
  const reaches = ir.where.filter((c): c is ReachClause => c.kind === "reach");
  const names = new Map<ReachClause, string>();
  for (const [i, r] of reaches.entries()) {
    names.set(r, i === 0 ? "reach" : `reach_${i}`);
  }
  const rules = reaches.length > 0 ? compileReachRules(reaches, names) : undefined;
  const inSlots = compileIn(ir.in, rules !== undefined);
  const find = ir.find.map(compileFind).join(" ");
  const where = ir.where.map((c) => compileClause(c, names)).join(" ");
  const edn = `[:find ${find}${inSlots} :where ${where}]`;
  return {
    query: normalizeEdnQuery(edn),
    ...(rules !== undefined ? { rules: normalizeEdnQuery(rules) } : {}),
  };
}

function compileIn(slots: string[] | undefined, needsRules: boolean): string {
  const rest = [...(slots ?? [])];
  if (needsRules && !rest.includes("%")) rest.unshift("%");
  if (rest.length === 0) return "";
  const parts = rest.map((s) => (s === "%" ? "%" : `?${s}`));
  return ` :in $ ${parts.join(" ")}`;
}

function compileFind(pos: FindPos): string {
  if (pos.kind === "var") return `?${pos.name}`;
  if (pos.kind === "aggregate") return `(${pos.op} ?${pos.of})`;
  return `(pull ?${pos.of} ${compilePull(pos.pattern)})`;
}

function compilePull(pattern: PullSpec): string {
  const parts = pattern.map((el) => {
    if (typeof el === "string") return el;
    const inner = Object.entries(el)
      .map(([attr, nested]) => `${attr} ${compilePull(nested)}`)
      .join(" ");
    return `{${inner}}`;
  });
  return `[${parts.join(" ")}]`;
}

function compileClause(clause: Clause, names: ReadonlyMap<ReachClause, string>): string {
  switch (clause.kind) {
    case "pattern":
      return `[?${clause.entity} ${clause.attr} ${compileTerm(clause.value)}]`;
    case "children": {
      const cs = `?__kb_cs_${clause.parent}`;
      return `[?${clause.parent} :node/children ${cs}] [(identity ${cs}) [?${clause.child} ...]]`;
    }
    case "reach": {
      const name = present(names.get(clause), "reach rule name");
      if (clause.maxHops !== undefined) return `(${name} ?${clause.from} ?${clause.to} 1)`;
      return `(${name} ?${clause.from} ?${clause.to})`;
    }
    case "rule":
      return `(${clause.name} ${clause.args.map(compileTerm).join(" ")})`;
    default: {
      const _exhaustive: never = clause;
      return _exhaustive;
    }
  }
}

function compileTerm(term: Term): string {
  if (term.t === "var") return `?${term.name}`;
  if (term.t === "str") return JSON.stringify(term.value);
  if (term.t === "bool") return term.value ? "true" : "false";
  return String(term.value);
}

function compileReachRules(
  reaches: ReachClause[],
  names: ReadonlyMap<ReachClause, string>,
): string {
  const chunks = reaches.map((r) => compileOneReach(r, present(names.get(r), "reach rule name")));
  return `[${chunks.join(" ")}]`;
}

function compileOneReach(clause: ReachClause, name: string): string {
  const edge = clause.edge;
  const min = clause.minHops ?? 1;
  const max = clause.maxHops;
  const identity = min === 0 ? `[(${name} ?a ?b) [(= ?a ?b)]]` : "";
  if (max === undefined) {
    return `${identity}[(${name} ?a ?b) [?a ${edge} ?b]] [(${name} ?a ?b) [?a ${edge} ?mid] (${name} ?mid ?b)]`;
  }
  return `${identity}[(${name} ?a ?b ?h) [?a ${edge} ?b] [(<= ?h ${max})]] [(${name} ?a ?b ?h) [?a ${edge} ?mid] [(< ?h ${max})] [(+ ?h 1) ?h2] (${name} ?mid ?b ?h2)]`;
}
