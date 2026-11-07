// The local cache of who holds a role. The source of truth is the threads' own metadata; this is
// only an index over it, so lookups (configure is synchronous, events are frequent) need no
// request. It is persisted to make a restart cheap, and `rebuild` recomputes it from metadata
// alone, which also picks up roles written by anyone else (another plugin, an agent, the API).
import { parseMeta, type Role, type RoleMeta } from "./model.ts";

export interface MemberIndexPort {
  /** Ids of non-archived threads, one page (includes hidden threads). */
  listThreadIds(offset: number, limit: number): Promise<string[]>;
  /** This plugin's namespace for up to 200 threads; threads without one are omitted. */
  listMeta(threadIds: string[]): Promise<{ threadId: string; metadata: unknown }[]>;
}

export const PAGE = 200;
export const MAX_PAGES = 50;

export class MemberIndex {
  private readonly members = new Map<string, RoleMeta>();
  /** Writes made while a rebuild is reading, replayed over its result (it may predate them). */
  private dirty: Map<string, RoleMeta | null> | null = null;

  get size(): number {
    return this.members.size;
  }

  get(threadId: string): RoleMeta | null {
    return this.members.get(threadId) ?? null;
  }

  has(threadId: string): boolean {
    return this.members.has(threadId);
  }

  set(threadId: string, meta: RoleMeta | null): void {
    if (meta === null) this.members.delete(threadId);
    else this.members.set(threadId, meta);
    this.dirty?.set(threadId, meta);
  }

  /** Call before a rebuild starts reading; `replace` then keeps writes made in between. */
  beginRebuild(): void {
    this.dirty = new Map();
  }

  ids(): string[] {
    return [...this.members.keys()];
  }

  entries(): [string, RoleMeta][] {
    return [...this.members.entries()];
  }

  reportsToOf = (threadId: string): string | null => this.members.get(threadId)?.reportsTo ?? null;

  find(filter: { role: Role; projectId?: string; taskKey?: string }): string[] {
    const found: [string, RoleMeta][] = [];
    for (const [threadId, meta] of this.members) {
      if (meta.role !== filter.role) continue;
      if (filter.projectId !== undefined && meta.projectId !== filter.projectId) continue;
      if (filter.taskKey !== undefined && meta.taskKey !== filter.taskKey) continue;
      found.push([threadId, meta]);
    }
    // Oldest role first: the established member wins over a later duplicate.
    return found.sort((a, b) => a[1].since - b[1].since || a[0].localeCompare(b[0])).map(([threadId]) => threadId);
  }

  replace(next: Map<string, RoleMeta>): void {
    const dirty = this.dirty;
    this.dirty = null;
    this.members.clear();
    for (const [threadId, meta] of next) this.members.set(threadId, meta);
    for (const [threadId, meta] of dirty ?? []) {
      if (meta === null) this.members.delete(threadId);
      else this.members.set(threadId, meta);
    }
  }

  toJSON(): Record<string, RoleMeta> {
    return Object.fromEntries(this.members);
  }

  static fromJSON(raw: unknown): MemberIndex {
    const index = new MemberIndex();
    if (typeof raw !== "object" || raw === null) return index;
    for (const [threadId, value] of Object.entries(raw as Record<string, unknown>)) {
      const meta = parseMeta(value);
      if (meta !== null && threadId.startsWith("thr_")) index.set(threadId, meta);
    }
    return index;
  }
}

/** Every non-archived thread's role, read from metadata only. */
export async function rebuildMembers(port: MemberIndexPort): Promise<{ members: Map<string, RoleMeta>; scanned: number; truncated: boolean }> {
  const members = new Map<string, RoleMeta>();
  let scanned = 0;
  let truncated = true;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const ids = await port.listThreadIds(page * PAGE, PAGE);
    scanned += ids.length;
    if (ids.length > 0) {
      for (const row of await port.listMeta(ids)) {
        const meta = parseMeta(row.metadata);
        if (meta !== null) members.set(row.threadId, meta);
      }
    }
    if (ids.length < PAGE) {
      truncated = false;
      break;
    }
  }
  return { members, scanned, truncated };
}
