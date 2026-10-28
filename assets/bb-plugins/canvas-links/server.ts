// bb-plugin-canvas-links — the backend. Serves the `Canvases` panel: it runs `canvas-link` through the host entry
// (host.ts) on the thread's workspace machine, as the thread's session and in its workspace, so Thread / Project
// scopes, Link and Unlink mean what they mean to an agent in that thread. `open` runs on the machine the canvas
// lives on.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, type Run } from "./contract";
import { SCOPES, elsewhereHost, hostOfKey, parseListing, rowOf, type Listing } from "./lib/canvases";

const threadInput = z.object({ threadId: z.string().min(1) });
/** The selected canvases, by the key `canvas-link ls` printed. */
const keysInput = threadInput.extend({ keys: z.array(z.string().min(1).max(4096)).min(1).max(50) });
const outcome = z.object({ ok: z.boolean(), message: z.string() });
type Outcome = z.infer<typeof outcome>;

export type ThreadRef = { title: string | null };
export type ListAnswer = {
  listing: Listing | null;
  /** Why there is no listing: canvas-link missing, or failing. */
  error: string | null;
  threads: Record<string, ThreadRef>;
};

export const rpcContract = defineRpcContract({
  /** `canvas-link ls --<scope> --json` for the thread, plus the titles of the bb threads its rows link to. */
  list: {
    input: threadInput.extend({ scope: z.enum(SCOPES) }),
    output: z.custom<ListAnswer>(v => typeof v === "object" && v !== null, "not a listing"),
  },
  /** `canvas-link ls --available --json`: every linked canvas, and the ones tldraw on the thread's machine knows. */
  available: {
    input: threadInput,
    output: z.custom<ListAnswer>(v => typeof v === "object" && v !== null, "not a listing"),
  },
  /** `canvas-link add <key>` for each, as the thread. */
  link: { input: keysInput, output: outcome },
  /** `canvas-link rm <key>` for each, as the thread: only the thread's own link ends. */
  unlink: { input: keysInput, output: outcome },
  /** `canvas-link open <key>` for each, on the machine that holds the canvas. */
  open: { input: keysInput, output: outcome },
});

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const failure = (r: Run) => (r.stderr.trim() || r.stdout.trim() || `canvas-link exited ${r.exitCode}`).replace(/^canvas-link: /, "");
const THREAD_TITLES_MAX = 50;
const count = (n: number) => (n === 1 ? "1 canvas" : `${n} canvases`);

/** Each key in turn; the first failure stops the rest and is the answer. */
async function each(keys: string[], one: (key: string) => Promise<Outcome>, done: string): Promise<Outcome> {
  for (const [i, key] of keys.entries()) {
    const r = await one(key).catch(err => ({ ok: false, message: message(err) }));
    if (!r.ok) return { ok: false, message: i === 0 ? r.message : `${r.message} (after ${count(i)})` };
  }
  return { ok: true, message: `${done} ${count(keys.length)}` };
}

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });

  /** Where the thread works: its workspace's machine and path, else bb's own machine. */
  async function workspace(threadId: string): Promise<{ hostId: string; cwd: string | null }> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId !== null) {
      const env = await bb.sdk.environments.get({ environmentId: thread.environmentId });
      if (env.path !== null) return { hostId: env.hostId, cwd: env.path };
    }
    const { primaryHostId } = await bb.sdk.system.config();
    if (primaryHostId === null || primaryHostId === undefined) throw new Error("The thread has no workspace and bb reports no machine of its own.");
    return { hostId: primaryHostId, cwd: null };
  }

  async function canvasLink(threadId: string, command: "ls" | "add" | "rm" | "open", args: string[], hostId?: string): Promise<Run> {
    const ws = await workspace(threadId);
    // On another machine the thread's workspace path means nothing; canvas-link runs from home there.
    const cwd = hostId === undefined || hostId === ws.hostId ? ws.cwd : null;
    return host.call("canvasLink", { command, args, cwd, threadId }, { hostId: hostId ?? ws.hostId });
  }

  async function titles(listing: Listing): Promise<Record<string, ThreadRef>> {
    const ids = [...new Set(listing.canvases.flatMap(c => rowOf(c).threads.map(t => t.id)))].slice(0, THREAD_TITLES_MAX);
    const pairs = await Promise.all(
      ids.map(async id => {
        try {
          const t = await bb.sdk.threads.get({ threadId: id });
          return [id, { title: t.title ?? null }] as const;
        } catch {
          // A thread on another bb server, or deleted: the chip shows its id.
          return null;
        }
      }),
    );
    return Object.fromEntries(pairs.filter(p => p !== null));
  }

  /** bb host ids by canvas-link hostname, learned by asking each machine once. */
  const hostIds = new Map<string, string>();
  async function hostIdFor(name: string): Promise<string | null> {
    const known = hostIds.get(name);
    if (known !== undefined) return known;
    const hosts = await bb.sdk.hosts.list();
    await Promise.all(
      hosts
        .filter(h => h.status === "connected" && ![...hostIds.values()].includes(h.id))
        .map(async h => {
          try {
            hostIds.set(await host.call("hostname", {}, { hostId: h.id }), h.id);
          } catch {
            // Offline, or without this plugin's host entry yet.
          }
        }),
    );
    return hostIds.get(name) ?? null;
  }

  async function listing(threadId: string, args: string[]): Promise<ListAnswer> {
    try {
      const r = await canvasLink(threadId, "ls", [...args, "--json"]);
      if (r.exitCode !== 0) return { listing: null, error: failure(r), threads: {} };
      const listing = parseListing(r.stdout);
      return { listing, error: null, threads: await titles(listing) };
    } catch (err) {
      return { listing: null, error: message(err), threads: {} };
    }
  }

  /** `add` or `rm` one key as the thread. */
  const record = (threadId: string, command: "add" | "rm") => async (key: string): Promise<Outcome> => {
    const r = await canvasLink(threadId, command, [key]);
    return r.exitCode === 0 ? { ok: true, message: r.stdout.trim() } : { ok: false, message: failure(r) };
  };

  async function open(threadId: string, key: string): Promise<Outcome> {
    const canvasHost = hostOfKey(key);
    if (canvasHost === null) return { ok: false, message: `Not a canvas key: ${key}` };
    const hostId = await hostIdFor(canvasHost);
    if (hostId === null) return { ok: false, message: `The canvas is on ${canvasHost}, which bb cannot reach.` };
    const r = await canvasLink(threadId, "open", [key], hostId);
    if (r.exitCode === 0) return { ok: true, message: r.stdout.trim() };
    const elsewhere = elsewhereHost(r.exitCode, r.stdout);
    return { ok: false, message: elsewhere !== null ? `The canvas is on ${elsewhere}.` : failure(r) };
  }

  bb.rpc.register(rpcContract, {
    list: ({ threadId, scope }) => listing(threadId, [`--${scope}`]),
    available: ({ threadId }) => listing(threadId, ["--available"]),
    link: ({ threadId, keys }) => each(keys, record(threadId, "add"), "Linked"),
    unlink: ({ threadId, keys }) => each(keys, record(threadId, "rm"), "Unlinked"),
    open: ({ threadId, keys }) => each(keys, key => open(threadId, key), "Opened"),
  });

  bb.onDispose(() => hostIds.clear());
}
