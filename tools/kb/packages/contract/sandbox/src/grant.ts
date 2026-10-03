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
export const READ_SCOPES = ["none", "subject", "graph"] as const;
export type ReadScope = (typeof READ_SCOPES)[number];

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

/** How far a run reaches: the node it is shown for, and a way to read nodes. */
export interface GrantScope {
  readonly subject: string | null;
  readonly node: (id: string) => KbNode | undefined;
}

/** How many nodes a subject walk visits before it gives up and refuses. */
const MAX_SUBJECT_WALK = 50_000;

/** Whether `id` is `subject` or a node under it, walking down from the subject. */
export function withinSubject(scope: GrantScope, id: string): boolean {
  const { subject, node } = scope;
  if (subject === null) return false;
  const seen = new Set<string>();
  const stack = [subject];
  while (stack.length > 0 && seen.size < MAX_SUBJECT_WALK) {
    const at = stack.pop();
    if (at === undefined || seen.has(at)) continue;
    if (at === id) return true;
    seen.add(at);
    stack.push(...(node(at)?.children ?? []));
  }
  return false;
}

const decodeNodeId = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String }));

/**
 * Why the grant refuses a call to `action` with `args`, or `null` when it
 * covers it. The read scope governs `node.get` and `graph.query`; any other
 * action must be named.
 */
export function grantRefusal(
  grant: CodeGrant,
  scope: GrantScope,
  action: string,
  args: unknown,
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
  if (action === GRAPH_READ) {
    return grant.reads === "graph" ? null : "graph.query needs a grant that reads the graph";
  }
  return grant.actions.includes(action) ? null : `${action} is not in this code's grant`;
}
