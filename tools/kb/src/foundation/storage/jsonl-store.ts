import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { KbNode } from "../model.ts";
import { canonicalJson } from "./canonical.ts";
import type { Store, StoreTx } from "./store.ts";

/**
 * JSONL backend: `<root>/.kb/nodes.jsonl`
 * One canonical-JSON node per line, sorted by id. Atomic tmp+rename writes.
 */
export class JsonlStore implements Store {
  readonly path: string;

  constructor(root: string) {
    this.path = join(root, ".kb", "nodes.jsonl");
  }

  async load(): Promise<KbNode[]> {
    const file = Bun.file(this.path);
    if (!(await file.exists())) return [];

    const nodes: KbNode[] = [];
    const stream = file.stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim().length === 0) continue;
        nodes.push(JSON.parse(line) as KbNode);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      nodes.push(JSON.parse(buffer) as KbNode);
    }
    return nodes;
  }

  async commit(tx: StoreTx): Promise<void> {
    const existing = await this.load();
    const byId = new Map(existing.map((n) => [n.id, n]));
    for (const id of tx.deletes) byId.delete(id);
    for (const node of tx.upserts) byId.set(node.id, node);

    const sorted = [...byId.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const body =
      sorted.length === 0
        ? ""
        : sorted.map((n) => canonicalJson(n)).join("\n") + "\n";

    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await Bun.write(tmp, body);
    const { rename } = await import("node:fs/promises");
    await rename(tmp, this.path);
  }
}
