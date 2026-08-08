import type { KbNode, NodeId } from "../model.ts";

export interface StoreTx {
  upserts: KbNode[];
  deletes: NodeId[];
}

export interface Store {
  load(): Promise<KbNode[]>;
  commit(tx: StoreTx): Promise<void>;
}
