// The sandbox service: one per plugin load. It owns the records (what was asked, where it is), the
// admission queue, and the lifetime sweep, and it is the only caller of providers. Every surface
// (CLI, agent tools, HTTP for the SDK) reaches sandboxes through it, via the op table in ops.ts.
//
// Lifecycle: queued → running → destroyed | failed. `create` waits for admission and for the
// provider; `createMany` records every request at once and returns them queued, and each one
// starts as the budget frees up. Records survive a reload in the plugin's kv: queued ones are
// queued again, running ones the provider still holds keep their lease, and anything else is
// failed (records) or destroyed (provider leftovers).
import { randomBytes } from "node:crypto";
import { type ExecResult, type FileEntry, type Outcome, type SandboxProvider, SandboxNotFound } from "./contract.ts";
import type { Policy } from "./policy.ts";
import { type Lease, type Queue, createQueue } from "./queue.ts";
import { type ExecRequest, type ExecRequestInput, type SandboxSpec, type SandboxSpecInput, execRequestSchema, sandboxSpecSchema } from "./spec.ts";

export type SandboxState = "queued" | "running" | "destroyed" | "failed";

export interface SandboxRecord {
  id: string;
  provider: string;
  state: SandboxState;
  spec: SandboxSpec;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  /** startedAt + spec.timeoutSec; the sweep destroys the sandbox after it. */
  expiresAt?: number;
  error?: string;
  outcome?: Outcome;
}

/** The plugin's kv, or a Map in tests: the same four calls. */
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export function memoryStore(): Store {
  const rows = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return structuredClone(rows.get(key)) as T | undefined;
    },
    async set(key, value) {
      rows.set(key, structuredClone(value));
    },
    async delete(key) {
      rows.delete(key);
    },
    async list(prefix = "") {
      return [...rows.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

export interface ServiceOptions {
  providers: Record<string, SandboxProvider>;
  policy: Policy;
  store: Store;
  pressure?: () => boolean;
  now?: () => number;
  /** Destroyed and failed records are kept this long, then dropped. */
  retainMs?: number;
}

const KEY = (id: string) => `sandbox/${id}`;
const TERMINAL: SandboxState[] = ["destroyed", "failed"];

export function createService(options: ServiceOptions) {
  const { providers, policy, store } = options;
  const now = options.now ?? Date.now;
  const retainMs = options.retainMs ?? 7 * 24 * 3600_000;
  const queue: Queue = createQueue(policy.budget, options.pressure);
  const leases = new Map<string, Lease>();
  /** Aborts a queued or starting sandbox when it is destroyed first. */
  const starting = new Map<string, AbortController>();
  /** Settles when a sandbox leaves `queued`/starting, for `wait` and `create`. */
  const settled = new Map<string, Promise<SandboxRecord>>();

  const providerFor = (id: string): SandboxProvider => {
    const provider = providers[id];
    if (!provider) throw new Error(`unknown provider ${id}; known: ${Object.keys(providers).join(", ")}`);
    return provider;
  };

  const load = async (id: string): Promise<SandboxRecord> => {
    const record = await store.get<SandboxRecord>(KEY(id));
    if (!record) throw new SandboxNotFound(id);
    return record;
  };
  const save = (record: SandboxRecord) => store.set(KEY(record.id), record);

  const running = async (id: string): Promise<{ record: SandboxRecord; provider: SandboxProvider }> => {
    const record = await load(id);
    if (record.state !== "running") throw new Error(`sandbox ${id} is ${record.state}`);
    return { record, provider: providerFor(record.provider) };
  };

  const release = (id: string) => {
    leases.get(id)?.release();
    leases.delete(id);
  };

  /** Wait for admission, then create; the record ends running or failed. */
  const start = (record: SandboxRecord): Promise<SandboxRecord> => {
    const abort = new AbortController();
    starting.set(record.id, abort);
    const provider = providerFor(record.provider);
    const { cpus, memoryMiB } = record.spec.resources;
    const done = (async () => {
      try {
        const lease = await queue.acquire(record.id, { cpus, memoryMiB }, record.spec.priority, abort.signal);
        leases.set(record.id, lease);
        if (abort.signal.aborted) throw new Error("destroyed while starting");
        await provider.create(record.id, record.spec, abort.signal);
        const startedAt = now();
        Object.assign(record, { state: "running", startedAt, expiresAt: startedAt + record.spec.timeoutSec * 1000 });
      } catch (error) {
        release(record.id);
        await provider.destroy(record.id).catch(() => {});
        Object.assign(record, { state: "failed", endedAt: now(), error: (error as Error).message });
      } finally {
        starting.delete(record.id);
      }
      // destroy() got there first and already wrote the final record.
      const current = await store.get<SandboxRecord>(KEY(record.id));
      if (current && TERMINAL.includes(current.state)) return current;
      await save(record);
      return record;
    })();
    settled.set(record.id, done);
    void done.finally(() => settled.delete(record.id));
    return done;
  };

  const submit = async (input: SandboxSpecInput): Promise<SandboxRecord> => {
    const spec = sandboxSpecSchema.parse(input);
    const provider = providerFor(spec.provider ?? policy.defaultProvider);
    const record: SandboxRecord = {
      id: `sb-${randomBytes(5).toString("hex")}`,
      provider: provider.id,
      state: "queued",
      spec: { ...spec, provider: provider.id },
      createdAt: now(),
    };
    await save(record);
    return record;
  };

  const service = {
    providers,
    queue,

    /** Create one sandbox and wait until it can exec (or failed). */
    async create(input: SandboxSpecInput): Promise<SandboxRecord> {
      return await start(await submit(input));
    },

    /** Record every request now; each starts when the budget allows. */
    async createMany(inputs: SandboxSpecInput[]): Promise<SandboxRecord[]> {
      // Validate all before recording any, so a bad spec does not leave half a batch queued.
      const specs = inputs.map((input) => sandboxSpecSchema.parse(input));
      for (const spec of specs) providerFor(spec.provider ?? policy.defaultProvider);
      const records = [];
      for (const spec of specs) records.push(await submit(spec));
      for (const record of records) void start(record);
      return records;
    },

    async get(id: string): Promise<SandboxRecord & { position?: number }> {
      const record = await load(id);
      const position = queue.position(id);
      return position >= 0 ? { ...record, position } : record;
    },

    async list(filter: { state?: SandboxState; label?: Record<string, string> } = {}): Promise<SandboxRecord[]> {
      const records = [];
      for (const key of await store.list("sandbox/")) {
        const record = await store.get<SandboxRecord>(key);
        if (!record) continue;
        if (filter.state && record.state !== filter.state) continue;
        if (filter.label && Object.entries(filter.label).some(([k, v]) => record.spec.labels[k] !== v)) continue;
        records.push(record);
      }
      return records.sort((a, b) => a.createdAt - b.createdAt);
    },

    /** Wait until the sandbox is no longer queued (or `timeoutSec` passes) and return its record. */
    async wait(id: string, timeoutSec = 3600, signal?: AbortSignal): Promise<SandboxRecord> {
      const pending = settled.get(id);
      if (!pending) return await load(id);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutSec * 1000);
        signal?.addEventListener("abort", () => resolve(null), { once: true });
      });
      try {
        return (await Promise.race([pending, timeout])) ?? (await load(id));
      } finally {
        clearTimeout(timer);
      }
    },

    async exec(id: string, input: ExecRequestInput, signal?: AbortSignal): Promise<ExecResult> {
      const request: ExecRequest = execRequestSchema.parse(input);
      const { record, provider } = await running(id);
      // An exec never outlives its sandbox.
      const left = Math.max(1, Math.floor(((record.expiresAt ?? Infinity) - now()) / 1000));
      return await provider.exec(id, { ...request, timeoutSec: Math.min(request.timeoutSec ?? left, left) }, signal);
    },

    async readFile(id: string, path: string): Promise<Uint8Array> {
      const { provider } = await running(id);
      return await provider.readFile(id, path);
    },

    async writeFile(id: string, path: string, data: Uint8Array): Promise<void> {
      const { provider } = await running(id);
      await provider.writeFile(id, path, data);
    },

    async listFiles(id: string, path: string): Promise<FileEntry[]> {
      const { provider } = await running(id);
      return await provider.listFiles(id, path);
    },

    async previewUrl(id: string, port: number): Promise<string> {
      const { provider } = await running(id);
      if (!provider.previewUrl || !provider.capabilities.ports) throw new Error(`${provider.id} does not expose ports`);
      return await provider.previewUrl(id, port);
    },

    async snapshot(id: string): Promise<{ snapshotId: string }> {
      const { provider } = await running(id);
      if (!provider.snapshot || !provider.capabilities.snapshot) throw new Error(`${provider.id} does not snapshot`);
      return await provider.snapshot(id);
    },

    /** Where a host-side agent edits the sandbox's workspace, when the provider keeps it on the host. */
    async hostWorkspace(id: string): Promise<string | null> {
      const { provider } = await running(id);
      return provider.hostWorkspace?.(id) ?? null;
    },

    /** Idempotent; a queued sandbox leaves the queue, a running one is torn down. */
    async destroy(id: string, reason?: string): Promise<SandboxRecord> {
      const record = await load(id);
      if (TERMINAL.includes(record.state)) return record;
      queue.cancel(id, "destroyed while queued");
      starting.get(id)?.abort();
      const provider = providerFor(record.provider);
      try {
        record.outcome = await provider.destroy(id);
        record.state = "destroyed";
      } catch (error) {
        record.state = "failed";
        record.error = `destroy: ${(error as Error).message}`;
      }
      if (reason) record.error = record.error ? `${reason}; ${record.error}` : reason;
      record.endedAt = now();
      release(id);
      await save(record);
      return record;
    },

    status() {
      return {
        queue: queue.status(),
        defaultProvider: policy.defaultProvider,
        providers: Object.fromEntries(Object.values(providers).map((p) => [p.id, p.capabilities])),
      };
    },

    /** After a load: requeue, adopt, fail, and destroy leftovers. */
    async reconcile(): Promise<void> {
      const records = await service.list();
      const held = new Map<string, Set<string>>();
      for (const provider of Object.values(providers)) held.set(provider.id, new Set(await provider.list()));
      for (const record of records) {
        const holds = held.get(record.provider)?.has(record.id) ?? false;
        if (record.state === "running" && holds) {
          leases.set(record.id, queue.adopt({ cpus: record.spec.resources.cpus, memoryMiB: record.spec.resources.memoryMiB }));
        } else if (record.state === "queued" && !holds) {
          void start(record);
        } else if (!TERMINAL.includes(record.state)) {
          // Running but gone, or half-created when the server stopped.
          await service.destroy(record.id, "lost when the plugin reloaded");
        }
        held.get(record.provider)?.delete(record.id);
      }
      for (const [providerId, ids] of held) {
        for (const id of ids) await providerFor(providerId).destroy(id).catch(() => {});
      }
    },

    /** Destroy sandboxes past their lifetime, drop old records, and give the queue another look. */
    async sweep(): Promise<void> {
      const t = now();
      for (const record of await service.list()) {
        if (record.state === "running" && record.expiresAt !== undefined && record.expiresAt <= t) {
          await service.destroy(record.id, `lifetime of ${record.spec.timeoutSec}s reached`);
        } else if (TERMINAL.includes(record.state) && (record.endedAt ?? t) + retainMs < t) {
          await store.delete(KEY(record.id));
        }
      }
      queue.pump();
    },
  };
  return service;
}

export type SandboxService = ReturnType<typeof createService>;
