/**
 * A grant, what sandboxed code may ask of the graph, and how it decides a
 * call (DESIGN.md → Sandbox → Grants). A call the grant does not cover is
 * refused before it reaches the invoke core, and one it covers still meets
 * the approval policies there, as the `script` actor. A code view keeps its
 * grant as a setting (`@kb/code`).
 */
import { Option, Schema } from "effect";
import type { KbNode } from "@kb/model";

/**
 * How far code may read. `subject` is the node it is shown for and the nodes
 * under it, through `node.get`; `graph` is every node, through `node.get` and
 * `graph.query`; `none` reads nothing.
 */
const READ_SCOPES = ["none", "subject", "graph"] as const;

/**
 * What code may ask of the graph: its grant. It is part of what runs, so it
 * is inside the digest a person trusts, and widening it is new code.
 */
export const CodeGrant = Schema.Struct({
  reads: Schema.Literals(READ_SCOPES),
  /** Every other action the code may call, by id. */
  actions: Schema.Array(Schema.NonEmptyString),
}).annotate({
  description:
    "What the code may ask of the graph. reads: none, subject (the node it is shown for and the nodes under it, through node.get) or graph (every node, through node.get and graph.query). actions: the ids of any other actions it may call through kb.invoke; each call still meets the approval policies as the script actor, and a write that asks for a person waits for one.",
});
export type CodeGrant = typeof CodeGrant.Type;

/** The actions a read scope governs: listing them under `actions` changes nothing. */
export const NODE_READ = "node.get";
// GAP [[01M41DKVSGG1R5A27Q49SBPHDD]] A granted graph.query is bounded in its result,
// not in its cost: a deadline in the query layer closes it (DESIGN.md →
// Sandbox → Gaps).
export const GRAPH_READ = "graph.query";
/** The reads of the whole graph, which only a grant that reads the graph covers. */
const GRAPH_READS: ReadonlySet<string> = new Set([GRAPH_READ, "graph.search"]);

/** How a target names the outline's root: no node, so no subject holds it. */
export const ROOT_TARGET = "";

/** How far a run reaches: the node it is shown for, and a way to read nodes. */
export interface GrantScope {
  readonly subject: string | null;
  readonly node: (id: string) => KbNode | undefined;
}

/** How many nodes a subject walk visits before it gives up and refuses. */
const MAX_SUBJECT_WALK = 50_000;

/**
 * The nodes a run reaches: its subject and every node under it, walking
 * down from the subject; none when it runs for no node. The walk stops after
 * `MAX_SUBJECT_WALK` nodes, and what it did not visit is out of reach.
 */
export function subjectReach(scope: GrantScope): ReadonlySet<string> {
  const { subject, node } = scope;
  const seen = new Set<string>();
  const stack = subject === null ? [] : [subject];
  while (stack.length > 0 && seen.size < MAX_SUBJECT_WALK) {
    const at = stack.pop();
    if (at === undefined || seen.has(at)) continue;
    seen.add(at);
    stack.push(...(node(at)?.children ?? []));
  }
  return seen;
}

/** Whether `id` is `subject` or a node under it (`subjectReach`). */
export function withinSubject(scope: GrantScope, id: string): boolean {
  return subjectReach(scope).has(id);
}

const decodeNodeId = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String }));

const decodeFields = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

/**
 * The nodes a call with `input` acts on, read from the keys its action
 * declares (`ActionDefinition.targets`): each an id, a list of ids, or null
 * for the outline's root; undefined when the action declares none.
 */
export function callTargets(
  keys: readonly string[] | undefined,
  input: unknown,
): string[] | undefined {
  if (keys === undefined) return undefined;
  const fields: Readonly<Record<string, unknown>> = Option.getOrElse(
    decodeFields(input),
    () => ({}),
  );
  return keys.flatMap((key) => {
    const value = fields[key];
    if (value === null) return [ROOT_TARGET];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((id): id is string => typeof id === "string");
    return [];
  });
}

/** `id` as a call names it, the root as the root. */
const named = (id: string) => (id === ROOT_TARGET ? "the outline's root" : id);

/**
 * Why the grant refuses a call to `action` with `args`, or `null` when it
 * covers it. The read scope governs `node.get` and the graph's reads; any
 * other action must be named in the grant, and every node the call acts on
 * (`targets`, what the action declares the call names; undefined when it
 * declares none) must be the subject or under it, so a script reaches
 * nothing beyond the node it runs for through any action.
 */
export function grantRefusal(
  grant: CodeGrant,
  scope: GrantScope,
  action: string,
  args: unknown,
  targets: readonly string[] | undefined,
): string | null {
  if (action === NODE_READ) {
    if (grant.reads === "graph") return null;
    if (grant.reads === "none") return "this code's grant reads nothing (reads: none)";
    const id = Option.getOrUndefined(Option.map(decodeNodeId(args), (call) => call.id));
    if (id !== undefined && withinSubject(scope, id)) return null;
    return scope.subject === null
      ? "this code reads its subject, and it is shown for no node"
      : `${id ?? "(no id)"} is outside this code's subject ${scope.subject} (reads: subject)`;
  }
  if (GRAPH_READS.has(action)) {
    return grant.reads === "graph" ? null : `${action} needs a grant that reads the graph`;
  }
  if (!grant.actions.includes(action)) return `${action} is not in this code's grant`;
  if (targets === undefined) {
    return `${action} declares no node it acts on that a subject could hold, so no code may call it`;
  }
  if (targets.length === 0) return `this call of ${action} names no node it acts on`;
  const reach = subjectReach(scope);
  const outside = targets.filter((id) => !reach.has(id));
  if (outside.length === 0) return null;
  return scope.subject === null
    ? `${action} acts on ${outside.map(named).join(", ")}, and this code runs for no node`
    : `${action} acts on ${outside.map(named).join(", ")}, outside this code's subject ${scope.subject}`;
}
