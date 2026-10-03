/**
 * The vocabulary of approval (DESIGN.md → Action registry → Approval): who
 * makes a call, what can be decided about it, and the `#approval-policy`
 * nodes that decide. Stated once, here, because both the store (the seeded
 * tag, fields and option nodes) and the invoke core (which reads a call's
 * actor and the policies) speak it.
 */
import { SYSTEM_IDS, type KbNode, type NodeId } from "./model.ts";

/**
 * Who makes a call, as the caller declares it — like `approved`, a statement
 * and not a proof. `human` is a person's own gesture in the UI, `agent` is a
 * model acting for one (the sidebar agent, MCP, WebMCP), and `cli` is the
 * command line, which a person and an agent both use.
 */
export const ACTORS = ["human", "agent", "cli"] as const;
export type Actor = (typeof ACTORS)[number];

/**
 * What is decided about a call, from least to most restrictive: it runs, it
 * runs once a person approves it, or it never runs. The order is the one the
 * resolver compares decisions by.
 */
export const APPROVAL_DECISIONS = ["allow", "ask", "deny"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** The stricter of two decisions. */
export function stricterDecision(a: ApprovalDecision, b: ApprovalDecision): ApprovalDecision {
  return APPROVAL_DECISIONS.indexOf(a) >= APPROVAL_DECISIONS.indexOf(b) ? a : b;
}

/**
 * The option nodes a policy's `actor` and `decision` refer to: the children
 * of those fields (DESIGN.md → Kinds, roles and options). A policy names an
 * option by its id, never by its text, so renaming an option changes nothing
 * a policy decides.
 */
export const ACTOR_OPTION_IDS: Readonly<Record<Actor, NodeId>> = {
  human: "sys.approval.actor.human",
  agent: "sys.approval.actor.agent",
  cli: "sys.approval.actor.cli",
};
export const DECISION_OPTION_IDS: Readonly<Record<ApprovalDecision, NodeId>> = {
  allow: "sys.approval.decision.allow",
  ask: "sys.approval.decision.ask",
  deny: "sys.approval.decision.deny",
};

/**
 * The words `match` takes for a mode instead of an action: every action of
 * that mode. An action id has no space, so neither can be mistaken for one.
 */
export const MODE_MATCHES = { "every read": "read", "every write": "write" } as const;

/** One `#approval-policy` node, as the resolver reads it. */
export interface ApprovalPolicy {
  readonly id: NodeId;
  /** An action id, a pattern with `*` (any run of characters), or a mode word ({@link MODE_MATCHES}). */
  readonly match: string;
  /** The actor it is about; `null` is every actor. */
  readonly actor: Actor | null;
  readonly decision: ApprovalDecision;
}

function firstRef(node: KbNode, field: NodeId): NodeId | undefined {
  return node.props[field]?.find((value) => value.t === "ref")?.v;
}

function isPolicyNode(node: KbNode): boolean {
  return (node.props[SYSTEM_IDS.typeField] ?? []).some(
    (value) => value.t === "ref" && value.v === SYSTEM_IDS.approvalPolicyTag,
  );
}

/**
 * The policies among `nodes`: every node tagged `#approval-policy` that names
 * what it matches and what it decides. One that names neither, or names an
 * actor or a decision that is no option, decides nothing: a half-written
 * policy is skipped rather than guessed at.
 */
export function approvalPoliciesOf(nodes: Iterable<KbNode>): ApprovalPolicy[] {
  const policies: ApprovalPolicy[] = [];
  for (const node of nodes) {
    if (!isPolicyNode(node)) continue;
    const match = node.props[SYSTEM_IDS.approvalMatchField]
      ?.find((value) => value.t === "str")
      ?.v.trim();
    const decisionRef = firstRef(node, SYSTEM_IDS.approvalDecisionField);
    const decision = APPROVAL_DECISIONS.find((value) => DECISION_OPTION_IDS[value] === decisionRef);
    const actorRef = firstRef(node, SYSTEM_IDS.approvalActorField);
    const actor =
      actorRef === undefined ? null : ACTORS.find((value) => ACTOR_OPTION_IDS[value] === actorRef);
    if (match === undefined || match === "" || decision === undefined || actor === undefined) {
      continue;
    }
    policies.push({ id: node.id, match, actor, decision });
  }
  return policies;
}

/**
 * How specifically `match` names an action, or `null` when it does not name
 * it. Compared as a tuple, most specific first: the action's own id, then a
 * pattern by how many literal characters it holds, then a mode word, then a
 * pattern of nothing but `*`.
 */
export function matchSpecificity(
  match: string,
  action: { readonly id: string; readonly mode: { readonly kind: "read" | "write" } },
): readonly [number, number] | null {
  if (match === action.id) return [4, match.length];
  const mode = Object.entries(MODE_MATCHES).find(([words]) => words === match)?.[1];
  if (mode !== undefined) return mode === action.mode.kind ? [2, 0] : null;
  if (!match.includes("*")) return null;
  const pattern = match
    .split("*")
    .map((part) => part.replaceAll(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  if (!new RegExp(`^${pattern}$`).test(action.id)) return null;
  const literal = match.replaceAll("*", "").length;
  return literal > 0 ? [3, literal] : [1, 0];
}

/** The datalog query for every `#approval-policy` node, as a query node runs it. */
export const APPROVAL_POLICIES_QUERY = `[:find ?id :where [?n :f/${SYSTEM_IDS.typeField} ?t] [?t :node/id "${SYSTEM_IDS.approvalPolicyTag}"] [?n :node/id ?id]]`;

/** A policy node, as the seed writes its defaults. */
export function approvalPolicyNode(base: KbNode, policy: Omit<ApprovalPolicy, "id">): KbNode {
  return {
    ...base,
    props: {
      ...base.props,
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.approvalPolicyTag }],
      [SYSTEM_IDS.approvalMatchField]: [{ t: "str", v: policy.match }],
      ...(policy.actor === null
        ? {}
        : { [SYSTEM_IDS.approvalActorField]: [{ t: "ref", v: ACTOR_OPTION_IDS[policy.actor] }] }),
      [SYSTEM_IDS.approvalDecisionField]: [{ t: "ref", v: DECISION_OPTION_IDS[policy.decision] }],
    },
  };
}
