import { Context, type Effect } from "effect";
import type { DomainError, KbNode, StoreTx } from "@kb/model";

/**
 * A write as a family plans it: the transaction to make over the graph as it
 * is (`nodes`), null for none, or a refusal.
 */
export type GraphPlan = (nodes: readonly KbNode[]) => Effect.Effect<StoreTx | null, DomainError>;

/**
 * Core's write path, as a port a family's action writes through. It is the
 * path every core action commits by, not a second one: `commit(plan)` plans
 * the write over the session's graph as it has caught up, and lands it only
 * on that state, planning it again when another process wrote in between,
 * so a node rewritten from what was read never loses a concurrent write
 * (`persistPlannedEffect`). The commit checks the transaction's integrity,
 * asks the approval resolver again with what it writes when it runs inside
 * an invocation, records it with the call's origin, and moves the session's
 * index and transaction log with it. It answers what it committed, or null
 * when the plan had nothing to write, and fails with the `DomainError`
 * `persistEffect` fails with, or the plan's refusal.
 */
export interface GraphWritesPort {
  readonly commit: (plan: GraphPlan) => Effect.Effect<StoreTx | null, DomainError>;
}

export class GraphWrites extends Context.Service<GraphWrites, GraphWritesPort>()(
  "kb/GraphWrites",
) {}
