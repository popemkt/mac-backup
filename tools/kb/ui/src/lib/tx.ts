import type { WireNode } from "@kb/protocol";

/** Deep-clone a wire node list (snapshot for optimistic revert). */
export function cloneWireNodes(nodes: WireNode[]): WireNode[] {
  return structuredClone(nodes);
}

export function wireById(nodes: WireNode[]): Map<string, WireNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

export function findParentWire(
  nodes: WireNode[],
  childId: string,
): WireNode | null {
  return nodes.find((n) => n.children.includes(childId)) ?? null;
}

export function cloneWire(n: WireNode): WireNode {
  return structuredClone(n);
}

/** Merge upserts/deletes into a wire node set (pure). */
export function mergeTx(
  nodes: WireNode[],
  upserts: WireNode[],
  deletes: string[],
): WireNode[] {
  const byId = wireById(nodes);
  for (const id of deletes) byId.delete(id);
  for (const u of upserts) byId.set(u.id, cloneWire(u));
  return [...byId.values()];
}

export function nowIso(): string {
  return new Date().toISOString();
}
