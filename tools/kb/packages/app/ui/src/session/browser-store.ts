import { Effect } from "effect";
import type { EffectStore } from "@kb/contracts";
import type { DomainError, KbNode, StoreTx } from "@kb/model";

/** In-memory persistence side of the browser's replicated kb session. */
export class BrowserStore implements EffectStore {
  readonly path = "browser";
  readonly fingerprint = Effect.succeed(null);
  readonly loadEffect: Effect.Effect<KbNode[], DomainError>;

  private readonly byId = new Map<string, KbNode>();

  constructor(nodes: readonly KbNode[]) {
    this.replace(nodes);
    this.loadEffect = Effect.sync(() => [...this.byId.values()]);
  }

  commitEffect(tx: StoreTx): Effect.Effect<void, DomainError> {
    return Effect.sync(() => this.apply(tx));
  }

  /** Keep the store side current when the replica ingests a server tx. */
  apply(tx: StoreTx): void {
    for (const id of tx.deletes) this.byId.delete(id);
    for (const node of tx.upserts) this.byId.set(node.id, node);
  }

  /** Replace the snapshot after an authoritative server snapshot. */
  replace(nodes: readonly KbNode[]): void {
    this.byId.clear();
    for (const node of nodes) this.byId.set(node.id, node);
  }
}
