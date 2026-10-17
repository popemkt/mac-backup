/**
 * A script's call, decided against what its run may reach (DESIGN.md →
 * Sandbox → Grants): the grant its host stamped on the call, and the node
 * the run is for. The invoke core asks this for every call made as the
 * `script` actor, from either host — the page's frame and the server's
 * runs alike — so a script reaches through any action only what its
 * subject holds, as the action declares what a call acts on (`targets`).
 */
import { Option, Schema } from "effect";
import type {
  ActionDefinition,
  ActionInvocation,
  ActionRequest,
  KbContext,
  RunningCall,
} from "@kb/contracts";
import { isVocabulary, type KbNode, type NodeId, type StoreTx } from "@kb/model";
import { CodeGrant, callTargets, grantRefusal, subjectReach } from "@kb/sandbox";

const decodeGrant = Schema.decodeUnknownOption(CodeGrant);

/**
 * `request` as a call made while `outer` runs, as an action calls another
 * through its host (`CoreInvoke`): a call a script's call makes is that
 * script's, with its reach, whatever it says, so the grant follows the call
 * down; any other is made by the actor it names, or else by its caller's.
 * Null for a request naming no actor made while nothing runs: no one makes
 * it.
 */
export function callWithin(outer: RunningCall | null, request: ActionInvocation): ActionInvocation;
export function callWithin(
  outer: RunningCall | null,
  request: ActionRequest,
): ActionInvocation | null;
export function callWithin(
  outer: RunningCall | null,
  request: ActionRequest,
): ActionInvocation | null {
  const caller = outer?.invocation;
  if (caller?.actor === "script") {
    const { approved: _ignored, ...rest } = request;
    return {
      ...rest,
      actor: "script",
      ...(caller.script === undefined ? {} : { script: caller.script }),
    };
  }
  const actor = request.actor ?? caller?.actor;
  return actor === undefined ? null : { ...request, actor };
}

/** Why a script may not make this call, with the grant it was decided by; null when it may, or when it is no script's. */
export function scriptRefusal(
  def: Pick<ActionDefinition, "targets">,
  invocation: ActionInvocation,
  input: unknown,
  ctx: KbContext,
): { readonly message: string; readonly details?: unknown } | null {
  if (invocation.actor !== "script") return null;
  const scope = invocation.script;
  if (scope === undefined) {
    return { message: "a script's call says what its run may reach, and this one says nothing" };
  }
  const grant = Option.getOrUndefined(decodeGrant(scope.grant));
  if (grant === undefined) return { message: "this script's call carries no grant kb can read" };
  const refusal = grantRefusal(
    grant,
    { subject: scope.subject, node: (id) => ctx.index.getNode(id) },
    invocation.id,
    input,
    callTargets(def.targets, input),
  );
  return refusal === null ? null : { message: refusal, details: { grant } };
}

/** The nodes `ids` names that `reach` does not hold, said for a refusal; null when it holds them all. */
function beyond(reach: ReadonlySet<NodeId>, ids: Iterable<NodeId>): NodeId[] | null {
  const outside = [...new Set(ids)].filter((id) => !reach.has(id));
  return outside.length === 0 ? null : outside;
}

/** The node each node is under, in the graph `after` reads, found when first asked. */
function parentsAfter(
  ids: readonly NodeId[],
  after: (id: NodeId) => KbNode | undefined,
): (id: NodeId) => NodeId | undefined {
  let parents: Map<NodeId, NodeId> | undefined;
  return (id) => {
    parents ??= new Map(
      ids.flatMap((at) => {
        const node = after(at);
        return node === undefined ? [] : node.children.map((child) => [child, node.id] as const);
      }),
    );
    return parents.get(id);
  };
}

/**
 * Why a script's call may not commit `tx`, or null when it may, or when the
 * call is no script's (DESIGN.md → Sandbox → Grants). Every write passes the
 * commit, whichever action planned it, so the reach of a script's writes is
 * decided there, by what the transaction does rather than what the call's
 * input names: each node it deletes, and each it writes as it was and as it
 * will be, is the subject or under it, and so is each node a written node
 * comes to point at (`KbIndex.referencesOf`), unless it is of the
 * vocabulary every node is written in (`isVocabulary`: a tag, a field, an
 * option). A reference already there is the script's to keep: it may move
 * the card a person made for a node elsewhere, and may not make one.
 */
export function scriptWriteRefusal(
  invocation: ActionInvocation,
  tx: StoreTx,
  ctx: KbContext,
): { readonly message: string; readonly details: unknown } | null {
  if (invocation.actor !== "script") return null;
  const subject = invocation.script?.subject ?? null;
  const written = new Map(tx.upserts.map((node) => [node.id, node]));
  const deleted = new Set(tx.deletes);
  const before = (id: NodeId) => ctx.index.getNode(id);
  const after = (id: NodeId): KbNode | undefined =>
    deleted.has(id) ? undefined : (written.get(id) ?? before(id));
  const was = subjectReach({ subject, node: before });
  const willBe = subjectReach({ subject, node: after });
  const refuse = (what: string, ids: NodeId[]) => ({
    message: `${invocation.id} ${what} ${ids.join(", ")}, outside this script's subject ${subject ?? "(none)"}`,
    details: { subject, outside: ids },
  });
  const touched = beyond(was, [
    ...tx.deletes,
    ...tx.upserts.flatMap((node) => (before(node.id) === undefined ? [] : [node.id])),
  ]);
  if (touched !== null) return refuse("writes", touched);
  const placed = beyond(
    willBe,
    tx.upserts.map((node) => node.id),
  );
  if (placed !== null) return refuse("puts", placed);
  const parentOf = parentsAfter([...ctx.nodes.map((node) => node.id), ...written.keys()], after);
  const pointed = beyond(
    willBe,
    tx.upserts.flatMap((node) => {
      const had = before(node.id);
      const old = had === undefined ? new Set<NodeId>() : ctx.index.referencesOf(had);
      return [...ctx.index.referencesOf(node)].filter(
        (id) => !old.has(id) && !isVocabulary(id, after, parentOf),
      );
    }),
  );
  return pointed === null ? null : refuse("points at", pointed);
}

/**
 * The nodes a call may read, as it reads them, of `nodes` (of two with one
 * id, the later): every one for any call but a script's, and for a script
 * whose grant reads the graph; for any other script, its subject and what
 * is under it in full, and every other node bare — its id, with no words,
 * fields or children — so what points at it still finds it and what it says
 * stays unread. An action that reads kb around what a call names (a
 * canvas's description, its lints, its picture) reads it through these.
 */
export function readableNodes(
  invocation: ActionInvocation | undefined,
  nodes: readonly KbNode[],
): KbNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (invocation?.actor !== "script") return [...byId.values()];
  const grant = Option.getOrUndefined(decodeGrant(invocation.script?.grant));
  if (grant?.reads === "graph") return [...byId.values()];
  const reach = subjectReach({
    subject: invocation.script?.subject ?? null,
    node: (id) => byId.get(id),
  });
  return [...byId.values()].map((node) =>
    reach.has(node.id) ? node : { ...node, text: "", props: {}, children: [] },
  );
}
