// bb-plugin-kb — linked items, the backend half: which kb things (canvases, for now) each bb thread wrote or
// linked, kept in the plugin's own database, and the RPC the "kb canvases" panel (linked-panel.tsx) reads.
//
// The link is bb's knowledge, so it lives here and not in kb (docs/research/2026-10-25-kb-topology.md in the
// dotfiles). kb gives two generic things: a write carries the caller's `via` label, and `graph.changes` reads
// the log back. Every thread's writes are labelled `bb:<thread>`: kb_call states it on the envelope, and the
// thread's own kb CLI and kb MCP get it as KB_VIA, which this file contributes to every provider. A background
// loop reads the log and records a link for each canvas a labelled write touched. The rules are lib/links.ts.
import { basename } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  KINDS,
  SCOPES,
  openCanvasOf,
  parseChangePage,
  touches,
  viaOfThread,
  type How,
  type Kind,
  type LinkedItem,
  type Scope,
} from "./lib/links";

/** What the links need of kb: one action, the root it serves, and the tab session a thread's panel shows. */
export interface KbAccess {
  call(
    id: string,
    input: Record<string, unknown>,
    options?: { session?: string },
  ): Promise<{ ok: true; output: unknown } | { ok: false; message: string }>;
  root(): Promise<string | null>;
  session(threadId: string): string | undefined;
}

export type LinksAnswer = {
  items: LinkedItem[];
  /** Why the list may be stale or empty: kb unreachable, or not configured. */
  error: string | null;
  /** Titles of the threads the rows link to, by id; absent for a thread bb cannot find. */
  titles: Record<string, string | null>;
};

const threadInput = z.object({ threadId: z.string().min(1) });
const outcome = z.object({ ok: z.boolean(), message: z.string() });

export const linksContract = defineRpcContract({
  /** The items a scope shows for the thread, after reading kb's log up to now. */
  links: {
    input: threadInput.extend({ scope: z.enum(SCOPES as [Scope, ...Scope[]]) }),
    output: z.custom<LinksAnswer>(v => typeof v === "object" && v !== null, "not a listing"),
  },
  /** Link the canvas the thread's kb tab shows to the thread. */
  linkOpen: { input: threadInput, output: outcome },
  /** Show an item in the thread's kb tab: now when the tab is live, else as soon as it reports its session. */
  openItem: { input: threadInput.extend({ id: z.string().min(1).max(256) }), output: outcome },
});

/** bb's agent providers, each told KB_VIA. A provider not installed here is never started, so naming it is free. */
const PROVIDERS = ["claude-code", "codex", "pi", "acp-omp", "acp-opencode", "acp-grok", "acp-hermes-agent", "acp-cursor"];
const POLL_MS = 10_000;
const PAGE = 500;
const TITLES_MAX = 50;

const MIGRATIONS = [
  `CREATE TABLE items (store TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
     edited_at INTEGER, gone INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (store, id))`,
  `CREATE TABLE links (store TEXT NOT NULL, id TEXT NOT NULL, thread TEXT NOT NULL, project TEXT, host TEXT,
     how TEXT NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (store, id, thread))`,
  `CREATE TABLE cursor (store TEXT PRIMARY KEY, rev INTEGER NOT NULL)`,
];

type Row = {
  id: string;
  kind: string;
  name: string;
  edited_at: number | null;
  gone: number;
  thread: string;
  host: string | null;
  how: string;
  last_at: number;
};

type Where = { project: string | null; host: string | null };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function registerLinks(bb: BbPluginApi, kb: KbAccess): { onSession(threadId: string, session: string | null): void } {
  for (const provider of PROVIDERS) {
    try {
      bb.providers.experimental_contributeEnv(provider, ({ threadId }) => [
        { name: "KB_VIA", value: viaOfThread(threadId), reason: "Label this thread's kb writes, so the kb plugin links what it touched" },
      ]);
    } catch (err) {
      // An experimental surface a bb release may lack: kb_call still labels its own calls.
      bb.log.warn(`links: no KB_VIA for ${provider}: ${message(err)}`);
    }
  }

  const db = () => {
    const handle = bb.storage.database();
    bb.storage.migrate(handle, MIGRATIONS);
    return handle;
  };

  /** Where a thread works: its bb project and machine, read once. A thread bb cannot find works nowhere. */
  const places = new Map<string, Where>();
  async function whereIs(threadId: string): Promise<Where> {
    const known = places.get(threadId);
    if (known !== undefined) return known;
    let where: Where = { project: null, host: null };
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      let host: string | null = null;
      if (thread.environmentId !== null) host = (await bb.sdk.environments.get({ environmentId: thread.environmentId })).hostId;
      where = { project: thread.projectId ?? null, host };
    } catch {
      // Deleted, or another bb server's thread: linked, but in no project.
    }
    places.set(threadId, where);
    return where;
  }

  function link(store: string, id: string, threadId: string, where: Where, how: How, at: number) {
    db()
      .prepare(
        `INSERT INTO links (store, id, thread, project, host, how, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (store, id, thread) DO UPDATE SET last_at = MAX(last_at, excluded.last_at),
           how = CASE WHEN links.how = 'linked' THEN 'linked' ELSE excluded.how END`,
      )
      .run(store, id, threadId, where.project, where.host, how, at, at);
  }

  function remember(store: string, kind: Kind, id: string, name: string, at: number) {
    db()
      .prepare(
        `INSERT INTO items (store, id, kind, name, edited_at, gone) VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT (store, id) DO UPDATE SET name = excluded.name, kind = excluded.kind, gone = 0,
           edited_at = MAX(COALESCE(edited_at, 0), excluded.edited_at)`,
      )
      .run(store, id, kind, name, at);
  }

  // GAP [[01M5QJFVQ61E19BAB2KXC0FA4M]]: only the kb behind KB_SOCKET is read; a Mac's own stores and repo .kb
  // stores a thread writes are not.
  /** Read kb's log from the cursor to its head, recording every canvas a change touched. One run at a time. */
  let running: Promise<string> | null = null;
  function sync(): Promise<string> {
    running ??= (async () => {
      const root = await kb.root();
      if (root === null) throw new Error("kb did not say which root it serves");
      const cursor = db().prepare<[string], { rev: number }>("SELECT rev FROM cursor WHERE store = ?").get(root);
      let since = cursor?.rev ?? 0;
      for (;;) {
        const answer = await kb.call("graph.changes", { since, limit: PAGE });
        if (!answer.ok) throw new Error(answer.message);
        const page = parseChangePage(answer.output);
        if (page === null) throw new Error("this kb has no graph.changes yet; it needs a newer kb");
        for (const t of touches(page.changes)) {
          if (t.gone) {
            db().prepare("UPDATE items SET gone = 1 WHERE store = ? AND id = ?").run(root, t.id);
            continue;
          }
          remember(root, t.kind, t.id, t.name, t.at);
          if (t.thread !== null) link(root, t.id, t.thread, await whereIs(t.thread), "wrote", t.at);
        }
        // A log that no longer reaches back to the cursor (compacted, or another kb): carry on from its head.
        since = page.complete ? (page.changes.at(-1)?.rev ?? page.head) : page.head;
        db().prepare("INSERT INTO cursor (store, rev) VALUES (?, ?) ON CONFLICT (store) DO UPDATE SET rev = excluded.rev").run(root, since);
        if (!page.complete || page.changes.length < PAGE) return root;
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  async function titles(ids: string[]): Promise<Record<string, string | null>> {
    const pairs = await Promise.all(
      ids.slice(0, TITLES_MAX).map(async id => {
        try {
          return [id, (await bb.sdk.threads.get({ threadId: id })).title ?? null] as const;
        } catch {
          return null;
        }
      }),
    );
    return Object.fromEntries(pairs.filter(p => p !== null));
  }

  async function openCanvas(threadId: string): Promise<string | null> {
    const session = kb.session(threadId);
    if (session === undefined) return null;
    const screen = await kb.call("ui.screen", { session });
    return screen.ok ? openCanvasOf(screen.output) : null;
  }

  async function list(threadId: string, scope: Scope): Promise<LinksAnswer> {
    let error: string | null = null;
    let store: string | null = null;
    try {
      store = await sync();
    } catch (err) {
      error = `kb could not be read: ${message(err)}`;
      store = await kb.root().catch(() => null);
    }
    if (store === null) return { items: [], error: error ?? "kb is not reachable", titles: {} };
    const where = await whereIs(threadId);
    const filter = scope === "session" ? "AND l.thread = ?" : scope === "project" ? "AND l.project = ?" : "";
    const args: string[] = scope === "session" ? [threadId] : scope === "project" ? [where.project ?? "\u0000none"] : [];
    const rows = db()
      .prepare<string[], Row>(
        `SELECT i.id, i.kind, i.name, i.edited_at, i.gone, l.thread, l.host, l.how, l.last_at
         FROM links l JOIN items i ON i.store = l.store AND i.id = l.id
         WHERE l.store = ? ${filter} ORDER BY l.last_at DESC`,
      )
      .all(store, ...args);
    const open = await openCanvas(threadId).catch(() => null);
    const label = basename(store);
    const byId = new Map<string, LinkedItem>();
    for (const r of rows) {
      let item = byId.get(r.id);
      if (item === undefined) {
        item = {
          key: r.id,
          kind: r.kind in KINDS ? (r.kind as Kind) : "canvas",
          id: r.id,
          name: r.name === "" ? r.id : r.name,
          store: label,
          editedAt: r.edited_at,
          linkedAt: r.last_at,
          gone: r.gone === 1,
          open: r.id === open,
          threads: [],
        };
        byId.set(r.id, item);
      }
      item.threads.push({ id: r.thread, how: r.how === "linked" ? "linked" : "wrote", at: r.last_at, host: r.host });
    }
    const items = [...byId.values()];
    return { items, error, titles: await titles([...new Set(items.flatMap(i => i.threads.map(t => t.id)))]) };
  }

  /** Routes waiting for a thread's kb tab to say its session. */
  const pending = new Map<string, string>();
  async function show(route: string, session: string): Promise<{ ok: boolean; message: string }> {
    const r = await kb.call("ui.navigate", { route }, { session });
    return r.ok ? { ok: true, message: "Shown in the kb tab" } : { ok: false, message: r.message };
  }

  bb.rpc.register(linksContract, {
    links: ({ threadId, scope }) => list(threadId, scope),
    linkOpen: async ({ threadId }) => {
      try {
        if (kb.session(threadId) === undefined) return { ok: false, message: "Open the kb tab beside this thread, and a canvas in it." };
        const id = await openCanvas(threadId);
        if (id === null) return { ok: false, message: "The kb tab shows no canvas." };
        const store = await kb.root();
        if (store === null) return { ok: false, message: "kb did not say which root it serves." };
        const node = await kb.call("node.get", { id, depth: 0 });
        const text = node.ok ? nodeText(node.output) : null;
        const now = Date.now();
        remember(store, "canvas", id, text ?? id, now);
        link(store, id, threadId, await whereIs(threadId), "linked", now);
        return { ok: true, message: `Linked ${text ?? id}` };
      } catch (err) {
        return { ok: false, message: message(err) };
      }
    },
    openItem: async ({ threadId, id }) => {
      try {
        const route = KINDS.canvas.route(id);
        const session = kb.session(threadId);
        if (session !== undefined) return await show(route, session);
        pending.set(threadId, route);
        return { ok: true, message: "Opening in the kb tab" };
      } catch (err) {
        return { ok: false, message: message(err) };
      }
    },
  });

  bb.background.service("kb-links", {
    async start(signal) {
      while (!signal.aborted) {
        await sync().catch(err => bb.log.debug(`links: ${message(err)}`));
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, POLL_MS);
          signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
      }
    },
  });
  bb.onDispose(() => {
    places.clear();
    pending.clear();
  });

  return {
    onSession(threadId, session) {
      const route = pending.get(threadId);
      if (session === null || route === undefined) return;
      pending.delete(threadId);
      void show(route, session).catch(() => undefined);
    },
  };
}

/** A node's text from `node.get`'s answer, whichever shape it has. */
function nodeText(output: unknown): string | null {
  if (typeof output !== "object" || output === null) return null;
  const o = output as Record<string, unknown>;
  const node = typeof o.node === "object" && o.node !== null ? (o.node as Record<string, unknown>) : o;
  return typeof node.text === "string" && node.text !== "" ? node.text : null;
}
