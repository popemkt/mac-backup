/**
 * The published surface: plain data, Promises and one error class. Written by
 * hand because the bundle built from this package carries no `@kb/*` types;
 * `tests/api.test.ts` holds these shapes to kb's node model at compile time.
 */
export type PropValue =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "date"; v: string }
  | { t: "ref"; v: string };

export interface KbNode {
  id: string;
  text: string;
  props: Record<string, PropValue[]>;
  children: string[];
  order?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  /** The store's fingerprint for exactly these nodes. Opaque; compare by equality. */
  readonly revision: string;
  /** Every node, in store order (by id). */
  readonly nodes: KbNode[];
}

export interface Commit {
  /** The `revision` this change was decided against. */
  expectedRevision: string;
  /** Whole nodes; each replaces the stored node with its id. */
  upserts: KbNode[];
  deletes: string[];
  /** Recorded on the transaction log entry. */
  origin?: string;
}

export interface QueryResult {
  /** The revision of the snapshot the rows were computed from. */
  readonly revision: string;
  readonly rows: unknown[][];
}

export interface KbClient {
  /** A fresh, consistent read. Reading never writes. */
  snapshot(): Promise<Snapshot>;
  /** A Datalog query over one fresh snapshot. */
  query(edn: string, inputs?: readonly unknown[]): Promise<QueryResult>;
  /**
   * Apply one batch if the store is still at `expectedRevision`, and return
   * the snapshot it produced. A `conflict` means the store moved: nothing was
   * written or recorded; read again and reconsider.
   */
  commit(change: Commit): Promise<Snapshot>;
}

export declare class KbClientError extends Error {
  /** kb's error code: `conflict`, `invalid_input`, `internal`, … */
  readonly code: string;
  constructor(code: string, message: string);
}

/**
 * A client over the store under `root`: `.kb/kb.sqlite` when that is present,
 * `.kb/nodes.jsonl` otherwise. Rejects with `conflict` when both are.
 */
export declare function openClient(root: string): Promise<KbClient>;
