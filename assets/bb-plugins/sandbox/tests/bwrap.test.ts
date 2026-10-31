import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_LIMITS, type SandboxSpec, SandboxUnsupported } from "../core/contract.ts";
import { bwrapArgs, createBwrapProvider, scopeArgs } from "../core/providers/bwrap.ts";

const spec = (egress: "none" | "open"): SandboxSpec => ({ limits: DEFAULT_LIMITS, network: { egress } });

test("isolates everything and shares the network only when egress is open", () => {
  const closed = bwrapArgs("/s/sbx-1", spec("none"), { argv: ["true"] });
  assert.ok(closed.includes("--unshare-all"));
  assert.ok(closed.includes("--clearenv"));
  assert.ok(!closed.includes("--share-net"));
  assert.ok(!closed.some((a) => a.startsWith("/home/") && a !== "/home/sandbox"));
  assert.deepEqual(closed.slice(-2), ["--", "true"]);
  assert.ok(bwrapArgs("/s/sbx-1", spec("open"), { argv: ["true"] }).includes("--share-net"));
});

test("cgroup scope carries every limit", () => {
  assert.deepEqual(scopeArgs({ cpus: 1.5, memoryMiB: 512, pids: 64, timeoutSec: 10 }).filter((a) => a.includes("=")), [
    "MemoryMax=512M",
    "MemorySwapMax=0",
    "CPUQuota=150%",
    "TasksMax=64",
  ]);
});

test("refuses what it cannot enforce", async () => {
  const root = await mkdtemp(join(tmpdir(), "sbx-"));
  const p = createBwrapProvider({ root, bwrap: "bwrap", cgroups: false, outputMaxBytes: 1024 });
  await assert.rejects(p.create({ ...spec("none"), network: { egress: "allowlist", hosts: ["x"] } }), SandboxUnsupported);
  await assert.rejects(p.create({ ...spec("none"), ports: [3000] }), SandboxUnsupported);
  await rm(root, { recursive: true, force: true });
});

test("file verbs stay inside /workspace, symlinks included", async () => {
  const root = await mkdtemp(join(tmpdir(), "sbx-"));
  const p = createBwrapProvider({ root, bwrap: "bwrap", cgroups: false, outputMaxBytes: 1024 });
  const box = await p.create(spec("none"));
  await p.writeFile(box.id, "/workspace/a/b.txt", "hi");
  assert.equal(new TextDecoder().decode(await p.readFile(box.id, "a/b.txt")), "hi");
  await assert.rejects(p.readFile(box.id, "/etc/passwd"));
  await assert.rejects(p.readFile(box.id, "../../x"));
  await symlink("/etc/passwd", join(root, box.id, "work", "leak"));
  await assert.rejects(p.readFile(box.id, "leak"));
  await assert.rejects(p.writeFile(box.id, "leak", "x"));
  await p.destroy(box.id);
  assert.equal(existsSync(join(root, box.id)), false);
  await rm(root, { recursive: true, force: true });
});
