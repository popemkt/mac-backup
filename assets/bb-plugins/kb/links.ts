// bb-plugin-kb — linked items, the backend half: which kb things (canvases, for now) each bb thread wrote or
// linked, kept in the plugin's own database, and the RPC the "kb canvases" panel (linked-panel.tsx) reads and
// acts through: list a scope, list every canvas kb has, link or unlink selected ones for the thread, open one.
//
// The link is bb's knowledge, so it lives here and not in kb (docs/research/2026-10-25-kb-topology.md in the
// dotfiles). kb gives two generic things: a write carries the caller's `via` label, and `graph.changes` reads
// the log back. Every thread's writes are labelled `bb:<thread>`: kb_call states it on the envelope, and the
// thread's own kb CLI and kb MCP get it as KB_VIA, which this file contributes to every provider. A background
// loop reads the log of those writes and records a link for each canvas one touched (lib/link-book.ts). `via`
// is advisory: any caller may state any label, so a link it makes is shown as claimed, not proven.
import { basename } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MIGRATIONS, linkBook, type Listing, type Where } from "./lib/link-book";
import { KINDS, SCOPES, openCanvasOf, viaOfThread } from "./lib/links";

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

export type LinksAnswer = Omit<Listing, "store"> & {
  /** Titles of the threads the rows link to, by id; absent for a thread bb cannot find. */
  titles: Record<string, string | null>;
};

const threadInput = z.object({ threadId: z.string().min(1) });
const outcome = z.object({ ok: z.boolean(), message: z.string() });
type Outcome = z.infer<typeof outcome>;
/** The selected kb items, by node id. */
const idsInput = threadInput.extend({ ids: z.array(z.string().min(1).max(256)).min(1).max(50) });
const listingOutput = z.custom<LinksAnswer>(v => typeof v === "object" && v !== null, "not a listing");

export const linksContract = defineRpcContract({
  /** The items a scope shows for the thread, after reading kb's log up to now. */
  links: { input: threadInput.extend({ scope: z.enum(SCOPES) }), output: listingOutput },
  /** Every canvas kb has, linked or not: what the panel's search looks through beyond the scope. */
  available: { input: threadInput, output: listingOutput },
  /** Link canvases to the thread, by hand. */
  link: { input: idsInput, output: outcome },
  /** End the thread's own links to canvases, by hand or by its writes; other threads' links stay. */
  unlink: { input: idsInput, output: outcome },
  /** Show an item in the thread's kb tab: now when the tab is live, else as soon as it reports its session. */
  openItem: { input: threadInput.extend({ id: z.string().min(1).max(256) }), output: outcome },
});

/** bb's agent providers, each told KB_VIA. A provider not installed here is never started, so naming it is free. */
const PROVIDERS = ["claude-code", "codex", "pi", "acp-omp", "acp-opencode", "acp-grok", "acp-hermes-agent", "acp-cursor"];
const POLL_MS = 10_000;
const TITLES_MAX = 50;
const count = (n: number) => (n === 1 ? "1 canvas" : `${n} canvases`);

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

  // Opened and migrated once per load; bb closes it on dispose.
  let handle: ReturnType<typeof bb.storage.database> | null = null;
  const db = () => {
    if (handle === null) {
      handle = bb.storage.database();
      bb.storage.migrate(handle, MIGRATIONS);
    }
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

  // GAP [[01M5QJFVQ61E19BAB2KXC0FA4M]]: only the kb behind KB_SOCKET is read; a Mac's own stores and repo .kb
  // stores a thread writes are not.
  let book: ReturnType<typeof linkBook> | null = null;
  const links = () => (book ??= linkBook(db(), kb, whereIs));

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

  /** A listing as the panel reads it: the canvas the thread's kb tab shows marked open, and its threads' titles. */
  async function answer({ store, items, error, incomplete }: Listing, threadId: string): Promise<LinksAnswer> {
    if (store === null) return { items, error, incomplete, titles: {} };
    const open = await openCanvas(threadId).catch(() => null);
    for (const item of items) item.open = item.id === open;
    return { items, error, incomplete, titles: await titles([...new Set(items.flatMap(i => i.threads.map(t => t.id)))]) };
  }

  async function link(threadId: string, ids: string[]): Promise<Outcome> {
    const store = await kb.root();
    if (store === null) return { ok: false, message: "kb did not say which root it serves." };
    const names = await links().canvases();
    if (names === null) return { ok: false, message: "kb did not list its canvases." };
    const missing = ids.filter(id => !names.has(id));
    if (missing.length > 0) return { ok: false, message: `kb has no canvas ${missing.join(", ")}` };
    for (const id of ids) await links().link(store, "canvas", id, names.get(id) || id, threadId, "linked", Date.now());
    return { ok: true, message: ids.length === 1 ? `Linked ${names.get(ids[0]) || ids[0]}` : `Linked ${count(ids.length)}` };
  }

  async function unlink(threadId: string, ids: string[]): Promise<Outcome> {
    const store = await kb.root();
    if (store === null) return { ok: false, message: "kb did not say which root it serves." };
    const ended = ids.filter(id => links().unlink(store, id, threadId)).length;
    return ended === 0 ? { ok: false, message: "This thread links none of them." } : { ok: true, message: `Unlinked ${count(ended)}` };
  }

  /** Routes waiting for a thread's kb tab to say its session. */
  const pending = new Map<string, string>();
  async function show(route: string, session: string): Promise<{ ok: boolean; message: string }> {
    const r = await kb.call("ui.navigate", { route }, { session });
    return r.ok ? { ok: true, message: "Shown in the kb tab" } : { ok: false, message: r.message };
  }

  bb.rpc.register(linksContract, {
    links: async ({ threadId, scope }) => answer(await links().list(threadId, scope, basename), threadId),
    available: async ({ threadId }) => answer(await links().available(threadId, basename), threadId),
    link: ({ threadId, ids }) => link(threadId, ids).catch(err => ({ ok: false, message: message(err) })),
    unlink: ({ threadId, ids }) => unlink(threadId, ids).catch(err => ({ ok: false, message: message(err) })),
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
        await links()
          .sync()
          .catch(err => bb.log.debug(`links: ${message(err)}`));
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
