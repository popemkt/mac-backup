// The server's promise cache. Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { promiseCache } from "../lib/cache.ts";

const counter = () => {
  let n = 0;
  return () => Promise.resolve(++n);
};

test("joins in-flight work, even for a fresh call", async () => {
  const cache = promiseCache<number>(1000);
  let calls = 0;
  let release!: (n: number) => void;
  const load = () => (calls++, new Promise<number>(r => (release = r)));
  const a = cache.get("k", load);
  const b = cache.get("k", load, { fresh: true });
  release(7);
  assert.deepEqual(await Promise.all([a, b]), [7, 7]);
  assert.equal(calls, 1);
});

test("reuses within the ttl; fresh reloads", async () => {
  const cache = promiseCache<number>(60_000);
  const load = counter();
  assert.equal(await cache.get("k", load), 1);
  assert.equal(await cache.get("k", load), 1);
  assert.equal(await cache.get("k", load, { fresh: true }), 2);
});

test("stale: serve answers with the old value and refreshes behind it", async () => {
  const cache = promiseCache<number>(0);
  const load = counter();
  const seen: number[] = [];
  assert.equal(await cache.get("k", load), 1);
  assert.equal(await cache.get("k", load, { stale: "serve", onRefreshed: v => seen.push(v) }), 1);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(seen, [2]);
  assert.equal(await cache.get("k", load, { stale: "serve" }), 2);
});

test("stale: wait answers with the new value; failures are not kept", async () => {
  const cache = promiseCache<number>(0);
  const load = counter();
  await cache.get("k", load);
  assert.equal(await cache.get("k", load, { stale: "wait" }), 2);
  await assert.rejects(cache.get("x", () => Promise.reject(new Error("boom"))));
  assert.equal(await cache.get("x", () => Promise.resolve(9)), 9);
});
