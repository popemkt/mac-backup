import type { KbNode } from "./foundation/model.ts";
import { ensureSystemSeed } from "./foundation/seed.ts";
import type { Store } from "./foundation/storage/index.ts";
import { JsonlStore } from "./foundation/storage/index.ts";
import {
  buildQueryDb,
  type QueryDb,
} from "./foundation/query/index.ts";

export interface KbContext {
  root: string;
  store: Store;
  nodes: KbNode[];
  qdb: QueryDb;
}

export async function openKb(root: string): Promise<KbContext> {
  const store = new JsonlStore(root);
  let nodes = await store.load();
  const { nodes: seeded, seeded: didSeed } = ensureSystemSeed(nodes);
  if (didSeed || nodes.length === 0) {
    nodes = seeded;
    await store.commit({ upserts: nodes, deletes: [] });
  } else {
    nodes = seeded;
  }
  const qdb = buildQueryDb(nodes);
  return { root, store, nodes, qdb };
}

export async function reload(ctx: KbContext): Promise<void> {
  ctx.nodes = await ctx.store.load();
  ctx.qdb = buildQueryDb(ctx.nodes);
}

export async function persist(
  ctx: KbContext,
  tx: { upserts: KbNode[]; deletes: string[] },
): Promise<void> {
  await ctx.store.commit(tx);
  const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
  for (const id of tx.deletes) byId.delete(id);
  for (const n of tx.upserts) byId.set(n.id, n);
  ctx.nodes = [...byId.values()];
  ctx.qdb = buildQueryDb(ctx.nodes);
}
