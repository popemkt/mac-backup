/**
 * The vocabulary of approval (DESIGN.md → Action registry → Approval): who
 * makes a call, and what can be decided about it. Stated once, here, because
 * both the store (the seeded option nodes a policy refers to) and the invoke
 * core (which reads a call's actor and decides) speak it.
 */

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
