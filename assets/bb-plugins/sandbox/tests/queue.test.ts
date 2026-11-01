import assert from "node:assert/strict";
import { test } from "node:test";
import { QueueRefused, createQueue } from "../core/queue.ts";

const small = { cpus: 1, memoryMiB: 1 };
const tick = () => new Promise((r) => setImmediate(r));

test("admits up to the sandbox cap, then waits", async () => {
  const q = createQueue({ sandboxes: 2, cpus: 100, memoryMiB: 100_000 });
  const admitted: string[] = [];
  const leases = ["a", "b", "c"].map((k) => q.acquire(k, small, 0).then((l) => (admitted.push(k), l)));
  await tick();
  assert.deepEqual(admitted, ["a", "b"]);
  assert.equal(q.status().waiting, 1);
  assert.equal(q.position("c"), 0);
  (await leases[0]).release();
  await tick();
  assert.deepEqual(admitted, ["a", "b", "c"]);
  for (const lease of await Promise.all(leases)) lease.release();
  assert.equal(q.status().running, 0);
});

test("respects the CPU and memory budget", async () => {
  const q = createQueue({ sandboxes: 10, cpus: 4, memoryMiB: 4096 });
  const a = await q.acquire("a", { cpus: 3, memoryMiB: 1024 }, 0);
  let b = false;
  void q.acquire("b", { cpus: 2, memoryMiB: 1024 }, 0).then(() => (b = true));
  await tick();
  assert.equal(b, false);
  a.release();
  await tick();
  assert.equal(b, true);
});

test("higher priority first, FIFO within a priority, and the head is not overtaken", async () => {
  const q = createQueue({ sandboxes: 1, cpus: 8, memoryMiB: 8192 });
  const hold = await q.acquire("hold", small, 0);
  const order: string[] = [];
  const take = (k: string, p: number, demand = small) => q.acquire(k, demand, p).then((l) => (order.push(k), l.release()));
  const all = [take("low-1", 0), take("high", 5), take("low-2", 0)];
  hold.release();
  await Promise.all(all);
  assert.deepEqual(order, ["high", "low-1", "low-2"]);
});

test("refuses what exceeds the whole budget", () => {
  const q = createQueue({ sandboxes: 3, cpus: 8, memoryMiB: 12288 });
  assert.throws(() => q.acquire("big", { cpus: 16, memoryMiB: 1 }, 0), QueueRefused);
  assert.throws(() => q.acquire("big", { cpus: 1, memoryMiB: 20000 }, 0), QueueRefused);
});

test("cancel and abort drop a waiter", async () => {
  const q = createQueue({ sandboxes: 1, cpus: 8, memoryMiB: 8192 });
  const hold = await q.acquire("hold", small, 0);
  const cancelled = q.acquire("x", small, 0);
  const abort = new AbortController();
  const aborted = q.acquire("y", small, 0, abort.signal);
  assert.equal(q.cancel("x"), true);
  abort.abort();
  await assert.rejects(cancelled, QueueRefused);
  await assert.rejects(aborted, QueueRefused);
  assert.equal(q.status().waiting, 0);
  assert.equal(q.cancel("nobody"), false);
  hold.release();
});

test("pressure holds admissions until pump", async () => {
  let loaded = true;
  const q = createQueue({ sandboxes: 4, cpus: 8, memoryMiB: 8192 }, () => loaded);
  let admitted = false;
  void q.acquire("a", small, 0).then(() => (admitted = true));
  await tick();
  assert.equal(admitted, false);
  assert.equal(q.status().pressure, true);
  loaded = false;
  q.pump();
  await tick();
  assert.equal(admitted, true);
});

test("adopt counts a running sandbox, release is idempotent", () => {
  const q = createQueue({ sandboxes: 1, cpus: 8, memoryMiB: 8192 });
  const lease = q.adopt({ cpus: 2, memoryMiB: 512 });
  assert.deepEqual(q.status().used, { cpus: 2, memoryMiB: 512 });
  lease.release();
  lease.release();
  assert.equal(q.status().running, 0);
  assert.deepEqual(q.status().used, { cpus: 0, memoryMiB: 0 });
});
