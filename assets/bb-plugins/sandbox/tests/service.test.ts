// The service's lifecycle over a test double: admission, createMany, destroy while queued,
// lifetimes, and reconciliation after a reload.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SandboxProvider } from "../core/contract.ts";
import { policySchema } from "../core/policy.ts";
import { createService, memoryStore } from "../core/service.ts";

/** Holds ids in a set; `gate` runs before create succeeds. */
function fakeProvider(gate?: () => Promise<void>): SandboxProvider & { held: Set<string> } {
  const held = new Set<string>();
  return {
    id: "fake",
    held,
    capabilities: {
      isolation: "namespaces",
      images: [],
      workspaces: ["empty"],
      egress: ["none"],
      enforces: ["cpus", "memoryMiB", "pids"],
      ports: false,
      pause: false,
      snapshot: false,
      secrets: "none",
    },
    async create(id) {
      await gate?.();
      held.add(id);
    },
    async exec(id, request) {
      if (!held.has(id)) throw new Error("gone");
      return { exitCode: 0, stdout: request.argv.join(" "), stderr: "", timedOut: false, durationMs: request.timeoutSec ?? 0 };
    },
    async readFile() {
      return new Uint8Array();
    },
    async writeFile() {},
    async listFiles() {
      return [];
    },
    async destroy(id) {
      held.delete(id);
      return {};
    },
    async list() {
      return [...held];
    },
  };
}

const policy = policySchema.parse({ defaultProvider: "fake", budget: { sandboxes: 2, cpus: 8, memoryMiB: 8192 } });
const tick = () => new Promise((r) => setImmediate(r));

test("create runs, execs, and destroy is idempotent", async () => {
  const provider = fakeProvider();
  const service = createService({ providers: { fake: provider }, policy, store: memoryStore() });
  const box = await service.create({});
  assert.equal(box.state, "running");
  assert.equal(box.provider, "fake");
  assert.equal((await service.exec(box.id, { argv: ["echo", "hi"] })).stdout, "echo hi");
  assert.equal((await service.destroy(box.id)).state, "destroyed");
  assert.equal((await service.destroy(box.id)).state, "destroyed");
  assert.equal(provider.held.size, 0);
  await assert.rejects(service.exec(box.id, { argv: ["true"] }), /destroyed/);
});

test("createMany queues past the budget and starts the rest as sandboxes end", async () => {
  const service = createService({ providers: { fake: fakeProvider() }, policy, store: memoryStore() });
  const boxes = await service.createMany([{}, {}, {}]);
  assert.deepEqual(boxes.map((b) => b.state), ["queued", "queued", "queued"]);
  await tick();
  const states = async () => (await Promise.all(boxes.map((b) => service.get(b.id)))).map((r) => r.state);
  assert.deepEqual(await states(), ["running", "running", "queued"]);
  assert.equal((await service.get(boxes[2].id)).position, 0);
  await service.destroy(boxes[0].id);
  assert.equal((await service.wait(boxes[2].id, 5)).state, "running");
});

test("destroying a queued sandbox drops it from the queue", async () => {
  const service = createService({ providers: { fake: fakeProvider() }, policy, store: memoryStore() });
  const boxes = await service.createMany([{}, {}, {}]);
  await tick();
  assert.equal((await service.destroy(boxes[2].id)).state, "destroyed");
  assert.equal(service.status().queue.waiting, 0);
  assert.equal((await service.wait(boxes[2].id, 5)).state, "destroyed");
});

test("a bad spec in a batch records none of it", async () => {
  const store = memoryStore();
  const service = createService({ providers: { fake: fakeProvider() }, policy, store });
  await assert.rejects(service.createMany([{}, { provider: "nope" }]), /unknown provider/);
  await assert.rejects(service.createMany([{}, { resources: { cpus: -1 } }]));
  assert.deepEqual(await store.list("sandbox/"), []);
});

test("a provider that cannot start the sandbox fails it and frees the budget", async () => {
  const provider = fakeProvider(() => Promise.reject(new Error("no bwrap")));
  const service = createService({ providers: { fake: provider }, policy, store: memoryStore() });
  const box = await service.create({});
  assert.equal(box.state, "failed");
  assert.match(box.error ?? "", /no bwrap/);
  assert.equal(service.status().queue.running, 0);
});

test("execs never outlive the sandbox, and the sweep ends it", async () => {
  let t = 1_000_000;
  const service = createService({ providers: { fake: fakeProvider() }, policy, store: memoryStore(), now: () => t });
  const box = await service.create({ timeoutSec: 60 });
  assert.equal((await service.exec(box.id, { argv: ["x"], timeoutSec: 600 })).durationMs, 60);
  t += 61_000;
  await service.sweep();
  const after = await service.get(box.id);
  assert.equal(after.state, "destroyed");
  assert.match(after.error ?? "", /lifetime/);
});

test("reconcile adopts what the provider still holds, requeues the queued, ends the rest", async () => {
  const store = memoryStore();
  const provider = fakeProvider();
  const first = createService({ providers: { fake: provider }, policy, store });
  const alive = await first.create({});
  const lost = await first.create({});
  provider.held.delete(lost.id);
  provider.held.add("sb-orphan");
  await store.set("sandbox/sb-queued", { ...alive, id: "sb-queued", state: "queued", startedAt: undefined });

  const second = createService({ providers: { fake: provider }, policy, store });
  await second.reconcile();
  await tick();
  assert.equal((await second.get(alive.id)).state, "running");
  assert.equal((await second.get(lost.id)).state, "destroyed");
  assert.equal((await second.wait("sb-queued", 5)).state, "running");
  assert.ok(!provider.held.has("sb-orphan"));
  assert.equal(second.status().queue.running, 2);
});
