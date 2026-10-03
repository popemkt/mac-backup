/**
 * How a grant (`CodeGrant`, a code view's setting in `@kb/views`) decides a
 * call (DESIGN.md → Sandbox → Grants). A call the grant does not cover is
 * refused before it reaches the invoke core, and one it covers still meets
 * the approval policies there, as the `script` actor.
 */
import { Option, Schema } from "effect";
import type { KbNode } from "@kb/model";
import type { CodeGrant } from "@kb/views";

/** The actions a read scope governs: listing them under `actions` changes nothing. */
export const NODE_READ = "node.get";
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
