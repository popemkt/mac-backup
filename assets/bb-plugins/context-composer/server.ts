// bb-plugin-context-composer — the bb adapter's backend. The composition model, targets and the trajectory protocol
// live in core/ (no host imports); this file connects them to bb:
// - reads a thread's inventory from the agent-artifacts plugin (its RPC), never from bb's state directly;
// - keeps saved manifests in the plugin's SQLite store, and records each spawn on the spawned thread itself
//   (its plugin metadata), which is also what agents.configure and the env resolvers read;
// - spawns a thread with a compiled manifest, and a hidden advisor thread for the trajectory chat;
// - serves `bb composer` for terminals and agents.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ClaudeInventory } from "../agent-artifacts/lib/claude";
import type { Inventory } from "../agent-artifacts/lib/inventory";
import { compositionFrom } from "./adapter/inventory.ts";
import { kbOutline, kbSchemaCommands } from "./core/kb.ts";
import { diff, emptyManifest, parseManifest, type Composition, type Manifest } from "./core/model.ts";
import { bbTargetFor, compile, envNames, targetById, type Plan } from "./core/targets.ts";
import { compositionMarkdown } from "./core/text.ts";
import { trajectoryBrief, type Message } from "./core/trajectory.ts";
import { ADVISOR_INSTRUCTIONS, parseThreadRecord, type ThreadRecord } from "./adapter/records.ts";

const INVENTORY_PLUGIN = "agent-artifacts";
const CACHE_MS = 60_000;

const manifestSchema = z.custom<Manifest>(v => parseManifest(v) !== null, "not a manifest");
const compositionSchema = z.custom<Composition>(v => typeof v === "object" && v !== null, "not a composition");

export const rpcContract = defineRpcContract({
  /** A thread's composition. `withProvider` also waits for Claude Code's own view (it starts a Claude Code session). */
  compose: {
    input: z.object({ threadId: z.string().min(1), withProvider: z.boolean().optional(), fresh: z.boolean().optional() }),
    output: compositionSchema,
  },
  /** Where a thread runs: what the spawn form and the model picker need. */
  basis: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ threadId: z.string(), title: z.string().nullable(), projectId: z.string(), environmentId: z.string().nullable(), providerId: z.string(), model: z.string().nullable() }),
  },
  /** Threads to compose from, newest first, and the threads this plugin spawned. */
  overview: {
    input: z.object({}),
    output: z.object({
      threads: z.array(z.object({ id: z.string(), title: z.string().nullable(), providerId: z.string(), updatedAt: z.number() })),
      spawned: z.array(z.object({ id: z.string(), title: z.string().nullable(), record: z.custom<ThreadRecord>() })),
    }),
  },
  manifests: { input: z.object({}), output: z.array(manifestSchema) },
  saveManifest: { input: z.object({ manifest: manifestSchema }), output: manifestSchema },
  deleteManifest: { input: z.object({ id: z.string().min(1) }), output: z.object({ ok: z.literal(true) }) },
  /** Start a thread with the manifest compiled for its provider. The plan is recomputed here, not trusted from the app. */
  spawn: {
    input: z.object({
      basisThreadId: z.string().min(1),
      manifest: manifestSchema,
      prompt: z.string().min(1).max(100_000),
      providerId: z.string().min(1),
      model: z.string().min(1),
      reasoningLevel: z.string().optional(),
      serviceTier: z.string().optional(),
      title: z.string().max(200).optional(),
    }),
    output: z.object({ threadId: z.string(), plan: z.custom<Plan>() }),
  },
  /** The hidden advisor thread for a basis thread: resumed if one is open, else started with a fresh brief. */
  advisor: {
    input: z.object({ basisThreadId: z.string().min(1), manifest: manifestSchema, goal: z.string().max(4000), restart: z.boolean().optional() }),
    output: z.object({ threadId: z.string(), resumed: z.boolean() }),
  },
  closeAdvisor: { input: z.object({ basisThreadId: z.string().min(1) }), output: z.object({ ok: z.literal(true) }) },
});

export type BasisInfo = z.infer<(typeof rpcContract)["basis"]["output"]>;

type SpawnArgs = Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0];
/** A record as the JSON object plugin metadata takes; it is plain data by construction. */
const metadata = (r: ThreadRecord) => r as unknown as NonNullable<SpawnArgs["pluginMetadata"]>;

type Row = { kind?: string; role?: string; text?: string; children?: readonly Row[] | null };

/** The thread's messages in order, from its timeline rows (turns nest their messages). */
function messagesOf(rows: readonly Row[]): Message[] {
  const out: Message[] = [];
  const visit = (r: Row) => {
    if (r.kind === "conversation" && (r.role === "user" || r.role === "assistant") && typeof r.text === "string" && r.text.trim() !== "") out.push({ role: r.role, text: r.text });
    for (const c of r.children ?? []) visit(c);
  };
  rows.forEach(visit);
  return out;
}

const HELP = [
  "Usage: bb composer [thread-id] [--target <id>] [--kb] [--json]",
  "",
  "The composed context of a thread: every artifact that feeds its agent, grouped",
  "by kind with token weights, and for each what removing it does on the target:",
  "enforced (the host takes it out), advisory (the agent is only told), or none.",
  "Defaults to the calling thread and the target for its provider.",
  "",
  "  --target <id>  bb:claude-code, bb:codex, bb:pi, bb:other, cli:claude-code, cli:codex",
  "  --kb           the composition as a kb outline (Tana Paste), and the schema commands",
  "  --json         the composition as JSON",
].join("\n");

export default async function plugin(bb: BbPluginApi) {
  // GAP [[01M5QKD7TMB3HDV65V543HTD9M]] this database lives in the bb server's data dir, which nothing backs up.
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE manifests (id TEXT PRIMARY KEY, title TEXT NOT NULL, basis_thread_id TEXT, body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);`,
  ]);

  // ---------------------------------------------------------------- compositions

  const cache = new Map<string, { at: number; value: Promise<Composition> }>();

  async function readComposition(threadId: string, withProvider: boolean): Promise<Composition> {
    const call = <T>(method: string) =>
      bb.sdk.plugins.callRpc<T>({ pluginId: INVENTORY_PLUGIN, method, input: { threadId }, outputSchema: z.custom<T>(v => typeof v === "object" && v !== null) });
    const inventory = await call<Inventory>("inventory");
    const claude =
      withProvider && inventory.thread.providerId === "claude-code"
        ? await call<{ inventory: ClaudeInventory | null; reason: string | null }>("claude").then(a => a.inventory)
        : null;
    return compositionFrom(inventory, claude, Date.now());
  }

  /** A thread's composition, shared inside the cache window; the full one (with the provider's view) is cached apart. */
  function composition(threadId: string, withProvider: boolean, fresh = false): Promise<Composition> {
    const key = `${threadId}:${withProvider}`;
    const hit = cache.get(key);
    if (!fresh && hit !== undefined && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = readComposition(threadId, withProvider);
    cache.set(key, { at: Date.now(), value });
    value.catch(() => cache.delete(key));
    return value;
  }

  // ---------------------------------------------------------------- manifests

  const listManifests = (): Manifest[] =>
    (db.prepare("SELECT body FROM manifests ORDER BY updated_at DESC").all() as { body: string }[]).flatMap(r => {
      const m = parseManifest(JSON.parse(r.body));
      return m === null ? [] : [m];
    });

  function saveManifest(m: Manifest): Manifest {
    const clean = parseManifest(m)!;
    db.prepare(
      `INSERT INTO manifests (id, title, basis_thread_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, basis_thread_id=excluded.basis_thread_id, body=excluded.body, updated_at=excluded.updated_at`,
    ).run(clean.id, clean.title, clean.basisThreadId, JSON.stringify(clean), clean.createdAt, clean.updatedAt);
    return clean;
  }

  // ---------------------------------------------------------------- thread records (plugin metadata)

  const records = new Map<string, { at: number; value: Promise<ThreadRecord | null> }>();
  function recordOf(threadId: string): Promise<ThreadRecord | null> {
    const hit = records.get(threadId);
    if (hit !== undefined && Date.now() - hit.at < 30_000) return hit.value;
    const value = bb.sdk.threads.getPluginMetadata({ threadId }).then(parseThreadRecord, () => null);
    records.set(threadId, { at: Date.now(), value });
    return value;
  }

  // What a composed thread's agent is told, and the advisor's rules. Sync, from the thread's own metadata.
  bb.agents.configure(context => {
    const record = parseThreadRecord(context.pluginMetadata);
    if (record?.role === "composed" && record.instructions !== "") return { tools: [], skills: [], instructions: record.instructions };
    if (record?.role === "advisor") return { tools: [], skills: [], instructions: ADVISOR_INSTRUCTIONS };
    return { tools: [], skills: [] };
  });

  // The enforced half for Claude Code and pi: env switches, only the names a target compiles, only on composed threads.
  for (const providerId of ["claude-code", "pi"] as const) {
    bb.providers.experimental_contributeEnv(providerId, async ({ threadId }) => {
      if (threadId === "") return [];
      const record = await recordOf(threadId);
      const target = record?.role === "composed" ? targetById(record.targetId) : undefined;
      if (record?.role !== "composed" || target?.surface !== "bb" || target.providerId !== providerId) return [];
      // Metadata is writable by anyone, the thread's own agent included: pass on only names the target compiles.
      const allowed = new Set(envNames(target));
      return Object.entries(record.env)
        .filter(([name]) => allowed.has(name))
        .map(([name, value]) => ({ name, value, reason: `context composer: manifest "${record.manifestTitle}"` }));
    });
  }

  // ---------------------------------------------------------------- RPC

  async function spawn(input: z.infer<(typeof rpcContract)["spawn"]["input"]>) {
    const basis = await bb.sdk.threads.get({ threadId: input.basisThreadId });
    const c = await composition(input.basisThreadId, true);
    const target = bbTargetFor(input.providerId);
    const plan = compile(target, c, input.manifest);
    const d = diff(c, input.manifest);
    const record: ThreadRecord = {
      role: "composed",
      manifestId: input.manifest.id,
      manifestTitle: input.manifest.title,
      basisThreadId: input.basisThreadId,
      targetId: target.id,
      instructions: plan.instructions,
      env: plan.env,
      excluded: d.removed.map(a => a.id),
      included: d.added.map(a => a.id),
      composedAt: Date.now(),
    };
    const thread = await bb.sdk.threads.spawn({
      projectId: basis.projectId,
      environment: basis.environmentId === null ? { type: "project-default" } : { type: "reuse", environmentId: basis.environmentId },
      providerId: input.providerId,
      model: input.model,
      ...(input.reasoningLevel === undefined ? {} : { reasoningLevel: input.reasoningLevel }),
      ...(input.serviceTier === undefined ? {} : { serviceTier: input.serviceTier }),
      executionInputSources: { providerId: "explicit", model: "explicit", ...(input.reasoningLevel === undefined ? {} : { reasoningLevel: "explicit" }) },
      prompt: input.prompt,
      title: input.title ?? `${input.manifest.title}: ${input.prompt.slice(0, 60)}`,
      pluginMetadata: metadata(record),
    });
    // Saved with the spawn, so the lineage always names a manifest that exists.
    saveManifest({ ...input.manifest, updatedAt: Date.now() });
    return { threadId: thread.id, plan };
  }

  async function advisor(input: z.infer<(typeof rpcContract)["advisor"]["input"]>) {
    const key = `advisor:${input.basisThreadId}`;
    const open = await bb.storage.kv.get(key);
    if (typeof open === "string" && input.restart !== true) {
      const t = await bb.sdk.threads.get({ threadId: open }).catch(() => null);
      if (t !== null && t.archivedAt === null) return { threadId: open, resumed: true };
    }
    if (typeof open === "string") await closeAdvisor(input.basisThreadId);
    const basis = await bb.sdk.threads.get({ threadId: input.basisThreadId });
    const [c, timeline] = await Promise.all([
      composition(input.basisThreadId, true),
      bb.sdk.threads.timeline({ threadId: input.basisThreadId, includeNestedRows: "true" }).catch(() => ({ rows: [] })),
    ]);
    const prompt = trajectoryBrief({ composition: c, manifest: input.manifest, target: bbTargetFor(basis.providerId), messages: messagesOf((timeline as { rows: readonly Row[] }).rows), goal: input.goal });
    const record: ThreadRecord = { role: "advisor", basisThreadId: input.basisThreadId };
    const thread = await bb.sdk.threads.spawn({
      projectId: basis.projectId,
      environment: basis.environmentId === null ? { type: "project-default" } : { type: "reuse", environmentId: basis.environmentId },
      providerId: basis.providerId,
      permissionMode: "accept-edits",
      executionInputSources: { providerId: "explicit", permissionMode: "explicit" },
      visibility: "hidden",
      lifecycleOwnerThreadId: input.basisThreadId,
      title: `Trajectory: ${basis.title ?? basis.id}`,
      prompt,
      pluginMetadata: metadata(record),
    });
    await bb.storage.kv.set(key, thread.id);
    return { threadId: thread.id, resumed: false };
  }

  async function closeAdvisor(basisThreadId: string) {
    const key = `advisor:${basisThreadId}`;
    const open = await bb.storage.kv.get(key);
    await bb.storage.kv.delete(key);
    if (typeof open !== "string") return;
    // Hidden worker threads must not keep an agent process: archive, then stop, whatever fails.
    await bb.sdk.threads.archive({ threadId: open }).catch(err => bb.log.warn(`archive advisor ${open}: ${String(err)}`));
    await bb.sdk.threads.stop({ threadId: open }).catch(err => bb.log.warn(`stop advisor ${open}: ${String(err)}`));
  }

  bb.rpc.register(rpcContract, {
    compose: ({ threadId, withProvider, fresh }) => composition(threadId, withProvider === true, fresh === true),
    basis: async ({ threadId }) => {
      const [t, options] = await Promise.all([bb.sdk.threads.get({ threadId }), bb.sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null)]);
      return { threadId: t.id, title: t.title, projectId: t.projectId, environmentId: t.environmentId, providerId: t.providerId, model: options?.model ?? null };
    },
    overview: async () => {
      const [threads, spawned] = await Promise.all([
        bb.sdk.threads.list({ limit: 30, archived: false }),
        bb.sdk.threads.list({ limit: 50, originPluginId: bb.pluginId, archived: false }),
      ]);
      const metadata = spawned.length === 0 ? null : await bb.sdk.threads.experimental_listPluginMetadata({ threadIds: spawned.map(t => t.id) }).catch(() => null);
      const byId = new Map(Object.entries((metadata as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}));
      return {
        threads: threads.filter(t => t.originPluginId !== bb.pluginId).map(t => ({ id: t.id, title: t.title, providerId: t.providerId, updatedAt: t.updatedAt })),
        spawned: spawned.flatMap(t => {
          const record = parseThreadRecord(byId.get(t.id));
          return record?.role === "composed" ? [{ id: t.id, title: t.title, record }] : [];
        }),
      };
    },
    manifests: () => listManifests(),
    saveManifest: ({ manifest }) => saveManifest(manifest),
    deleteManifest: ({ id }) => {
      db.prepare("DELETE FROM manifests WHERE id=?").run(id);
      return { ok: true as const };
    },
    spawn,
    advisor,
    closeAdvisor: async ({ basisThreadId }) => {
      await closeAdvisor(basisThreadId);
      return { ok: true as const };
    },
  });

  // ---------------------------------------------------------------- CLI

  bb.cli.register({
    name: "composer",
    summary: "The composed context of a thread: artifacts by kind with token weights, and what removing each does on a target (bb composer [thread-id] [--target <id>] [--kb] [--json])",
    async run(argv, ctx) {
      if (argv.includes("--help") || argv.includes("-h")) return { exitCode: 0, stdout: HELP };
      const at = argv.indexOf("--target");
      const targetArg = at === -1 ? undefined : argv[at + 1];
      const positionals = argv.filter((a, i) => !a.startsWith("--") && (at === -1 || i !== at + 1));
      const threadId = positionals[0] ?? ctx.threadId;
      if (threadId === undefined) return { exitCode: 2, stderr: `No thread: pass a thread id, or run this inside a bb thread.\n\n${HELP}` };
      try {
        const c = await composition(threadId, true);
        const target = targetArg === undefined ? bbTargetFor(c.basis.providerId) : targetById(targetArg);
        if (target === undefined) return { exitCode: 2, stderr: `Unknown target ${targetArg}.\n\n${HELP}` };
        if (argv.includes("--json")) return { exitCode: 0, stdout: JSON.stringify(c) };
        const m = emptyManifest({ id: "cli", title: `Composition of ${threadId}`, basisThreadId: threadId, now: Date.now() });
        if (argv.includes("--kb")) return { exitCode: 0, stdout: [...kbSchemaCommands(), "", kbOutline(c, m, target, m.title)].join("\n") };
        return { exitCode: 0, stdout: compositionMarkdown(c, target.id) };
      } catch (err) {
        return { exitCode: 1, stderr: `Could not compose thread ${threadId}: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  bb.onDispose(() => {
    cache.clear();
    records.clear();
  });
}
