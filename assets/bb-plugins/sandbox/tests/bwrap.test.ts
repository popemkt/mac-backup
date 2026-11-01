// The bubblewrap provider's own parts that need no bwrap: the isolation flags, the capped unit,
// and what it refuses to mount. Its behaviour is in contract.test.ts with every other provider.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { assertBindable, bwrapArgs, createBwrapProvider, unitArgs } from "../core/providers/bwrap.ts";
import { sandboxSpecSchema } from "../core/spec.ts";

const meta = (network: "none" | "open") => ({
  id: "sb-1",
  spec: sandboxSpecSchema.parse({ network: { egress: network }, env: { A: "1" } }),
  work: "/state/sb-1/work",
  cwd: "/workspace",
  masks: [".git"],
  mounts: [{ source: "/data/x", target: "/data", readOnly: true }],
  path: ["/run/current-system/sw/bin"],
});

test("unshares everything, clears the environment, and shares no network without egress", () => {
  const args = bwrapArgs("/state/sb-1", meta("none"), { argv: ["true"], env: {} });
  for (const flag of ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv"]) assert.ok(args.includes(flag), flag);
  assert.ok(!args.includes("--share-net"));
  assert.deepEqual(args.slice(args.indexOf("--") + 1), ["true"]);
  const pairs = (flag: string) => args.flatMap((a, i) => (a === flag ? [`${args[i + 1]} ${args[i + 2]}`] : []));
  assert.ok(pairs("--ro-bind").includes("/state/sb-1/work/.git /workspace/.git"), ".git is read-only");
  assert.ok(pairs("--ro-bind").includes("/data/x /data"));
  assert.ok(pairs("--setenv").includes("A 1"));
  assert.ok(!args.some((a) => a === homedir()), "the host home is never bound");
});

test("open egress shares the network and the resolver files", () => {
  const args = bwrapArgs("/state/sb-1", meta("open"), { argv: ["true"], env: {} });
  assert.ok(args.includes("--share-net"));
});

test("an exec's unit carries the sandbox's caps and a lifetime backstop", () => {
  const args = unitArgs("sandbox.slice", "bb-sandbox-sb-1-abc", { cpus: 1.5, memoryMiB: 2048, pids: 512 }, 60);
  for (const a of ["--user", "--pipe", "--wait", "--slice=sandbox.slice", "--unit=bb-sandbox-sb-1-abc"]) assert.ok(args.includes(a), a);
  assert.ok(!args.includes("--scope"), "a scope cannot be attached from bb's system cgroup");
  for (const p of ["MemoryMax=2048M", "MemorySwapMax=0", "CPUQuota=150%", "TasksMax=512", "RuntimeMaxSec=90"]) assert.ok(args.includes(p), p);
});

test("refuses to mount the root, the home directory, or above it", () => {
  assert.throws(() => assertBindable("/"));
  assert.throws(() => assertBindable(homedir()));
  assert.throws(() => assertBindable(dirname(homedir())));
  assert.doesNotThrow(() => assertBindable(`${homedir()}/projects/x`));
});

test("a missing bubblewrap fails create, and leaves nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "sandbox-nobwrap-"));
  try {
    const provider = createBwrapProvider({ root, bwrap: "/nonexistent/bwrap", nixpkgs: null, images: {}, slice: null, outputMaxBytes: 1024 });
    await assert.rejects(provider.create("sb-x", sandboxSpecSchema.parse({})), /bubblewrap is not available at \/nonexistent\/bwrap/);
    assert.deepEqual(await provider.list(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
