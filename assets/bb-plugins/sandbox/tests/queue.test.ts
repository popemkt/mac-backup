import assert from "node:assert/strict";
import { test } from "node:test";
import { QueueRefused, createQueue } from "../core/queue.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

test("admits up to the job cap, then waits", async () => {
  const q = createQueue({ maxJobs: 2, cpus: 100, memoryMiB: 100_000 });
  const gates = [deferred(), deferred(), deferred()];
  const started: number[] = [];
  const runs = gates.map((g, i) => q.run({ cpus: 1, memoryMiB: 1 }, 0, async () => (started.push(i), g.promise)));
  await Promise.resolve();
  assert.deepEqual(started, [0, 1]);
  assert.equal(q.status().waiting, 1);
  gates[0].resolve();
  await runs[0];
  assert.deepEqual(started, [0, 1, 2]);
  gates[1].resolve();
  gates[2].resolve();
  await Promise.all(runs);
  assert.equal(q.status().running, 0);
});

test("respects the CPU and memory budget", async () => {
  const q = createQueue({ maxJobs: 10, cpus: 4, memoryMiB: 4096 });
  const a = deferred();
  const started: string[] = [];
  const first = q.run({ cpus: 3, memoryMiB: 1024 }, 0, async () => (started.push("a"), a.promise));
  const second = q.run({ cpus: 2, memoryMiB: 1024 }, 0, async () => void started.push("b"));
  await Promise.resolve();
  assert.deepEqual(started, ["a"]);
  a.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(started, ["a", "b"]);
});

test("higher priority first, FIFO within a priority", async () => {
  const q = createQueue({ maxJobs: 1, cpus: 8, memoryMiB: 8192 });
  const hold = deferred();
  const order: string[] = [];
  const job = (name: string) => async () => void order.push(name);
  const runs = [
    q.run({ cpus: 1, memoryMiB: 1 }, 0, async () => hold.promise),
    q.run({ cpus: 1, memoryMiB: 1 }, 0, job("low-1")),
    q.run({ cpus: 1, memoryMiB: 1 }, 5, job("high")),
    q.run({ cpus: 1, memoryMiB: 1 }, 0, job("low-2")),
  ];
  hold.resolve();
  await Promise.all(runs);
  assert.deepEqual(order, ["high", "low-1", "low-2"]);
});

test("refuses a job larger than the whole budget", async () => {
  const q = createQueue({ maxJobs: 4, cpus: 2, memoryMiB: 1024 });
  await assert.rejects(q.run({ cpus: 4, memoryMiB: 1 }, 0, async () => 1), QueueRefused);
});

test("holds admissions under pressure and resumes on pump", async () => {
  let loaded = true;
  const q = createQueue({ maxJobs: 4, cpus: 8, memoryMiB: 8192 }, () => loaded);
  let ran = false;
  const run = q.run({ cpus: 1, memoryMiB: 1 }, 0, async () => void (ran = true));
  await Promise.resolve();
  assert.equal(ran, false);
  loaded = false;
  q.pump();
  await run;
  assert.equal(ran, true);
});

test("cancelling a queued job removes it", async () => {
  const q = createQueue({ maxJobs: 1, cpus: 8, memoryMiB: 8192 });
  const hold = deferred();
  const first = q.run({ cpus: 1, memoryMiB: 1 }, 0, async () => hold.promise);
  const abort = new AbortController();
  const second = q.run({ cpus: 1, memoryMiB: 1 }, 0, async () => 1, abort.signal);
  abort.abort();
  await assert.rejects(second, QueueRefused);
  assert.equal(q.status().waiting, 0);
  hold.resolve();
  await first;
});
