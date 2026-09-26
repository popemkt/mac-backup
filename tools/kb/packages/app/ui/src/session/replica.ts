/**
 * The browser replica's sync with the server's transaction log, as one state
 * machine (DESIGN-UI.md → Replica sync). It owns the replica's `rev` and the
 * phase the stream is in; the socket only carries messages, and the outline
 * store only projects what this machine decides to apply.
 */
import type { GraphSnapshot, ServerMessage } from "@kb/contracts";
import type { KbNode, StoreTx } from "@kb/model";

/** The graph-stream messages of the socket, as the server sends them. */
export type GraphMessage = Extract<ServerMessage, { op: "hello" | "tx" | "snapshot-required" }>;

/** Everything that can move the machine. */
export type SyncEvent =
  | GraphMessage
  | { op: "snapshot"; snapshot: GraphSnapshot }
  | { op: "snapshot-failed" }
  | { op: "reconcile" };

export type SyncPhase =
  | { readonly tag: "live" }
  /** A `since(from)` is outstanding; a later gap from the same rev is the same question. */
  | { readonly tag: "catching-up"; readonly from: number }
  /** The server answered `snapshot-required`; `/api/graph` is being fetched. */
  | { readonly tag: "awaiting-snapshot" };

/** Where the machine's decisions land: the visible replica. */
export interface ReplicaView {
  apply(tx: StoreTx, rev: number): void;
  install(nodes: KbNode[], rev: number): void;
}

/** What the machine asks of the network. */
export interface ReplicaLink {
  since(rev: number): void;
  fetchSnapshot(): void;
}

export class BrowserReplica {
  private phase: SyncPhase = { tag: "live" };
  private rev: number;
  private readonly view: ReplicaView;
  private readonly link: () => ReplicaLink | null;

  constructor(rev: number, view: ReplicaView, link: () => ReplicaLink | null) {
    this.rev = rev;
    this.view = view;
    this.link = link;
  }

  get state(): { readonly phase: SyncPhase; readonly rev: number } {
    return { phase: this.phase, rev: this.rev };
  }

  receive(event: SyncEvent): void {
    switch (event.op) {
      case "hello":
        // A new socket has no outstanding question, so a mismatch is always asked.
        if (event.rev !== this.rev) this.catchUp(true);
        else if (this.phase.tag === "catching-up") this.phase = { tag: "live" };
        return;
      case "tx":
        this.frame(event);
        return;
      case "snapshot-required":
        if (this.phase.tag === "awaiting-snapshot") return;
        this.phase = { tag: "awaiting-snapshot" };
        this.link()?.fetchSnapshot();
        return;
      case "snapshot":
        if (this.phase.tag !== "awaiting-snapshot") return;
        this.phase = { tag: "live" };
        this.rev = event.snapshot.rev;
        this.view.install(event.snapshot.nodes, this.rev);
        return;
      case "snapshot-failed":
        if (this.phase.tag === "awaiting-snapshot") this.phase = { tag: "live" };
        return;
      case "reconcile":
        this.catchUp(false);
        return;
      // Exhaustive over SyncEvent['op']; switch-exhaustiveness-check guards it
      // no default
    }
  }

  private frame(tx: Extract<GraphMessage, { op: "tx" }>): void {
    if (tx.rev <= this.rev) return; // duplicate/stale — already have it
    if (tx.rev !== this.rev + 1) {
      this.catchUp(false);
      return;
    }
    this.rev = tx.rev;
    if (this.phase.tag === "catching-up") this.phase = { tag: "live" };
    this.view.apply({ upserts: tx.upserts, deletes: tx.deletes }, this.rev);
  }

  /** Ask for everything after `rev`, once per rev unless the socket is new. */
  private catchUp(fresh: boolean): void {
    if (!fresh && this.phase.tag === "catching-up" && this.phase.from === this.rev) return;
    if (this.phase.tag !== "awaiting-snapshot") this.phase = { tag: "catching-up", from: this.rev };
    this.link()?.since(this.rev);
  }
}
