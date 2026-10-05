import { Context, type Effect } from "effect";
import type { DomainError, StoreTx } from "@kb/model";

/**
 * Core's write path, as a port a family's action writes through. It is the
 * path every core action commits by, not a second one: `commit(tx)` checks
 * the transaction's integrity against the graph it will merge into, asks the
 * approval resolver again with what it writes when it runs inside an
 * invocation, commits it with the call's origin, and moves the session's
 * index and transaction log with it. It fails with the `DomainError`
 * `persistEffect` fails with.
 */
export interface GraphWritesPort {
  readonly commit: (tx: StoreTx) => Effect.Effect<void, DomainError>;
}

export class GraphWrites extends Context.Service<GraphWrites, GraphWritesPort>()(
  "kb/GraphWrites",
) {}
