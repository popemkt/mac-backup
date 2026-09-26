/**
 * The browser replica's sync with the server's transaction log, as one state
 * machine. DESIGN-UI.md → Replica sync states it, transition by transition;
 * this class is that table. It owns the replica's `rev`, the server image, the
 * holds of unconfirmed local writes and the phase of the stream. The socket
 * only carries messages, and the outline store only projects what this
 * machine applies.
 */
import type { GraphSnapshot, ServerMessage } from "@kb/contracts";
import type { KbNode, StoreTx } from "@kb/model";
import { sortWireNodes } from "@/lib/tx";

/** The graph-stream messages of the socket, as the server sends them. */
export type GraphMessage = Extract<ServerMessage, { op: "hello" | "tx" | "snapshot-required" }>;

/** Everything on the network side that can move the machine. */
export type SyncEvent =
  | GraphMessage
  | { op: "snapshot"; snapshot: GraphSnapshot }
  | { op: "snapshot-failed" }
  | { op: "retry" }
  | { op: "reconcile" };

export type SyncPhase =
  | { readonly tag: "live" }
  /** A `since(from)` is outstanding; a later gap from the same rev is the same question. */
  | { readonly tag: "catching-up"; readonly from: number }
  /** The server answered `snapshot-required`; only an installed snapshot leaves this. */
  | { readonly tag: "awaiting-snapshot"; readonly fetching: boolean; readonly failures: number };

/** Where the machine's decisions land: the visible replica. */
export interface ReplicaView {
  apply(tx: StoreTx, rev: number): void;
  install(nodes: KbNode[], rev: number): void;
  /** The node as the replica shows it now, which for a held id is its local image. */
  local(id: string): KbNode | undefined;
}

/** What the machine asks of the network. */
export interface ReplicaLink {
  since(rev: number): void;
  fetchSnapshot(): void;
  retryAfter(ms: number): void;
}

/** One pushed local write the server has not confirmed: what it touched, and the rev its receipt named. */
export class Hold {
  readonly ids = new Set<string>();
  at: number | null = null;
}

const LIVE: SyncPhase = { tag: "live" };
const RETRY_INITIAL_MS = 500;
const RETRY_MAX_MS = 10_000;

export class BrowserReplica {
  private phase: SyncPhase = LIVE;
  private rev: number;
  private readonly server: Map<string, KbNode>;
  private readonly holds = new Set<Hold>();
  private readonly view: ReplicaView;
  private readonly link: () => ReplicaLink | null;

  constructor(
    nodes: readonly KbNode[],
    rev: number,
    view: ReplicaView,
    link: () => ReplicaLink | null,
  ) {
    this.server = new Map(nodes.map((node) => [node.id, node]));
    this.rev = rev;
    this.view = view;
    this.link = link;
  }

  get state(): { readonly phase: SyncPhase; readonly rev: number; readonly holds: number } {
    return { phase: this.phase, rev: this.rev, holds: this.holds.size };
  }

  receive(event: SyncEvent): void {
    const awaiting = this.phase.tag === "awaiting-snapshot" ? this.phase : null;
    switch (event.op) {
      case "tx":
        if (awaiting === null) this.frame(event);
        return;
      case "hello":
        if (awaiting !== null) this.fetch(awaiting);
        else if (event.rev === this.rev) this.phase = LIVE;
        // A new socket has no question outstanding, so a mismatch is always asked.
        else this.ask();
        return;
      case "snapshot-required":
        this.fetch(awaiting ?? { tag: "awaiting-snapshot", fetching: false, failures: 0 });
        return;
      case "retry":
        if (awaiting !== null) this.fetch(awaiting);
        return;
      case "snapshot-failed":
        if (awaiting?.fetching !== true) return;
        this.phase = { ...awaiting, fetching: false, failures: awaiting.failures + 1 };
        this.link()?.retryAfter(Math.min(RETRY_INITIAL_MS * 2 ** awaiting.failures, RETRY_MAX_MS));
        return;
      case "snapshot":
        if (awaiting !== null) this.install(event.snapshot);
        return;
      case "reconcile":
        if (awaiting === null && !this.asked()) this.ask();
        return;
      // Exhaustive over SyncEvent['op']; switch-exhaustiveness-check guards it
      // no default
    }
  }

  /** Hold what a local write touched until its push settles. `into` is joined while unsettled. */
  hold(ids: Iterable<string>, into?: Hold): Hold {
    const hold = into !== undefined && into.at === null && this.holds.has(into) ? into : new Hold();
    for (const id of ids) hold.ids.add(id);
    this.holds.add(hold);
    return hold;
  }

  /** The push succeeded: release once `rev` reaches the rev its receipt named. */
  settle(hold: Hold, rev: number): void {
    if (!this.holds.has(hold)) return;
    hold.at = rev;
    // While a snapshot is awaited, its install decides (it may already contain the write).
    if (this.phase.tag !== "awaiting-snapshot" && rev <= this.rev) this.show(this.release([hold]));
  }

  /** The push failed or threw: show the server image again, and ask what was missed. */
  drop(hold: Hold): void {
    if (!this.holds.has(hold)) return;
    this.show(this.release([hold]));
    this.receive({ op: "reconcile" });
  }

  private frame(tx: Extract<GraphMessage, { op: "tx" }>): void {
    if (tx.rev <= this.rev) return; // duplicate/stale — already have it
    if (tx.rev !== this.rev + 1) {
      if (!this.asked()) this.ask();
      return;
    }
    for (const id of tx.deletes) this.server.delete(id);
    for (const node of tx.upserts) this.server.set(node.id, node);
    this.rev = tx.rev;
    this.phase = LIVE;
    const shown: StoreTx = {
      upserts: tx.upserts.filter((node) => !this.isHeld(node.id)),
      deletes: tx.deletes.filter((id) => !this.isHeld(id)),
    };
    const released = this.release(this.confirmedBy(this.rev));
    this.view.apply(
      {
        upserts: [...shown.upserts, ...released.upserts],
        deletes: [...shown.deletes, ...released.deletes],
      },
      this.rev,
    );
  }

  private install(snapshot: GraphSnapshot): void {
    this.server.clear();
    for (const node of snapshot.nodes) this.server.set(node.id, node);
    this.rev = snapshot.rev;
    for (const hold of this.confirmedBy(this.rev)) this.holds.delete(hold);
    const shown = new Map(this.server);
    for (const hold of this.holds) {
      for (const id of hold.ids) {
        const local = this.view.local(id);
        if (local) shown.set(id, local);
        else shown.delete(id);
      }
    }
    this.phase = { tag: "catching-up", from: this.rev };
    this.view.install(sortWireNodes([...shown.values()]), this.rev);
    // Frames were ignored while the snapshot was awaited; ask for any after it.
    this.link()?.since(this.rev);
  }

  private fetch(awaiting: Extract<SyncPhase, { tag: "awaiting-snapshot" }>): void {
    if (awaiting.fetching) return;
    this.phase = { ...awaiting, fetching: true };
    this.link()?.fetchSnapshot();
  }

  private asked(): boolean {
    return this.phase.tag === "catching-up" && this.phase.from === this.rev;
  }

  private ask(): void {
    this.phase = { tag: "catching-up", from: this.rev };
    this.link()?.since(this.rev);
  }

  private confirmedBy(rev: number): Hold[] {
    return [...this.holds].filter((hold) => hold.at !== null && hold.at <= rev);
  }

  private isHeld(id: string): boolean {
    for (const hold of this.holds) if (hold.ids.has(id)) return true;
    return false;
  }

  /** Forget `done`; each id no other hold still holds goes back to its server image. */
  private release(done: readonly Hold[]): StoreTx {
    for (const hold of done) this.holds.delete(hold);
    const upserts: KbNode[] = [];
    const deletes: string[] = [];
    const freed = new Set(done.flatMap((hold) => [...hold.ids]));
    for (const id of freed) {
      if (this.isHeld(id)) continue;
      const node = this.server.get(id);
      if (node) upserts.push(node);
      else deletes.push(id);
    }
    return { upserts, deletes };
  }

  private show(tx: StoreTx): void {
    if (tx.upserts.length > 0 || tx.deletes.length > 0) this.view.apply(tx, this.rev);
  }
}
