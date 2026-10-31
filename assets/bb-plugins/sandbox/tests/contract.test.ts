// The provider contract (core/contract.ts), run over every provider the registry builds
// (core/providers/index.ts): one suite, every implementation. A provider that cannot run here (no
// bubblewrap on PATH or in $BWRAP; later, no credentials) is skipped with the reason, never
// silently passed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { SandboxUnsupported, type SandboxProvider } from "../core/contract.ts";
import { policySchema } from "../core/policy.ts";
import { createProviders } from "../core/providers/index.ts";
import { type SandboxSpecInput, execRequestSchema, sandboxSpecSchema } from "../core/spec.ts";

const which = (bin: string) => {
  try {
    return execFileSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
};
const bwrap = process.env.BWRAP ?? which("bwrap");

const root = await mkdtemp(join(tmpdir(), "sandbox-contract-"));
after(() => rm(root, { recursive: true, force: true }));
const providers = createProviders(policySchema.parse({ bwrap: { path: bwrap ?? "bwrap" } }), root);

/** Why a provider cannot run here, or null. */
const unavailable: Record<string, () => string | null> = {
  bwrap: () => (bwrap && existsSync(bwrap) ? null : "no bubblewrap (set BWRAP or put bwrap on PATH)"),
};

let n = 0;
const spec = (input: SandboxSpecInput = {}) => sandboxSpecSchema.parse(input);
const exec = (p: SandboxProvider, id: string, argv: string[], extra: object = {}) => p.exec(id, execRequestSchema.parse({ argv, ...extra }));

for (const provider of Object.values(providers)) {
  const reason = unavailable[provider.id]?.() ?? null;
  describe(`provider ${provider.id}`, { skip: reason ?? false }, () => {
    const fresh = async (input: SandboxSpecInput = {}) => {
      const id = `sb-contract-${(n += 1)}`;
      await provider.create(id, spec(input));
      return id;
    };

    test("runs a command and reports its exit code, output, stdin and environment", async () => {
      const id = await fresh({ env: { GREETING: "hi" } });
      try {
        const ok = await exec(provider, id, ["sh", "-c", 'read x; echo "$GREETING $x"; echo err >&2'], { stdin: "there\n" });
        assert.equal(ok.exitCode, 0);
        assert.equal(ok.stdout, "hi there\n");
        assert.equal(ok.stderr, "err\n");
        assert.equal((await exec(provider, id, ["sh", "-c", "exit 3"])).exitCode, 3);
      } finally {
        await provider.destroy(id);
      }
    });

    test("a command past its timeout is killed and says so", async () => {
      const id = await fresh();
      try {
        const r = await exec(provider, id, ["sleep", "30"], { timeoutSec: 1 });
        assert.equal(r.timedOut, true);
        assert.equal(r.exitCode, 137);
        assert.ok(r.durationMs < 10_000);
      } finally {
        await provider.destroy(id);
      }
    });

    test("files: what the host writes the sandbox reads, and back", async () => {
      const id = await fresh();
      try {
        await provider.writeFile(id, "/workspace/in/a.txt", Buffer.from("from host"));
        assert.equal((await exec(provider, id, ["cat", "/workspace/in/a.txt"])).stdout, "from host");
        await exec(provider, id, ["sh", "-c", "echo from sandbox > /workspace/b.txt"]);
        assert.equal(Buffer.from(await provider.readFile(id, "b.txt")).toString(), "from sandbox\n");
        const names = (await provider.listFiles(id, "/workspace")).map((e) => `${e.type}:${e.path}`).sort();
        assert.deepEqual(names, ["dir:/workspace/in", "file:/workspace/b.txt"]);
      } finally {
        await provider.destroy(id);
      }
    });

    test("file verbs stay inside the workspace, even through a planted symlink", async () => {
      const id = await fresh();
      try {
        await assert.rejects(provider.readFile(id, "../../etc/passwd"));
        await exec(provider, id, ["ln", "-s", "/etc/passwd", "/workspace/leak"]);
        await exec(provider, id, ["ln", "-s", "/tmp", "/workspace/out"]);
        await assert.rejects(provider.readFile(id, "leak"));
        await assert.rejects(provider.writeFile(id, "leak", Buffer.from("x")));
        await assert.rejects(provider.writeFile(id, "out/x", Buffer.from("x")));
      } finally {
        await provider.destroy(id);
      }
    });

    test("is isolated: no host home, no network without egress", async () => {
      const id = await fresh();
      try {
        const r = await exec(provider, id, ["sh", "-c", `test -e ${JSON.stringify(homedir())} && echo visible; cat /proc/net/dev | tail -n +3 | cut -d: -f1 | tr -d ' '`]);
        assert.ok(!r.stdout.includes("visible"), "the host's files are not visible");
        assert.deepEqual(r.stdout.trim().split("\n").filter(Boolean), ["lo"]);
      } finally {
        await provider.destroy(id);
      }
    });

    test("refuses what it does not support, leaving nothing behind", async () => {
      const caps = provider.capabilities;
      const unsupported: SandboxSpecInput[] = [
        ...(caps.egress.includes("allowlist") ? [] : [{ network: { egress: "allowlist" as const, hosts: ["example.com"] } }]),
        ...(caps.secrets === "none" ? [{ secrets: ["GITHUB_TOKEN"] }] : []),
        ...(caps.enforces.includes("gpus") ? [] : [{ resources: { gpus: 1 } }]),
        ...(caps.images.includes("oci") ? [] : [{ image: { oci: "ubuntu:24.04" } }]),
      ];
      for (const input of unsupported) {
        const id = `sb-contract-${(n += 1)}`;
        await assert.rejects(provider.create(id, spec(input)), SandboxUnsupported, JSON.stringify(input));
        assert.ok(!(await provider.list()).includes(id));
      }
    });

    test("a git workspace lands on its branch; destroy keeps the branch and reports it", async (t) => {
      if (!provider.capabilities.workspaces.includes("git")) return t.skip("no git workspaces");
      const repo = await mkdtemp(join(tmpdir(), "sandbox-repo-"));
      const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
      git("init", "-q", "-b", "main");
      git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
      const id = await fresh({ workspace: { git: { repo, branch: "sandbox/contract" } } });
      try {
        const workspace = provider.hostWorkspace?.(id);
        assert.ok(workspace);
        await writeFile(join(workspace, "made.txt"), "work\n");
        execFileSync("git", ["-C", workspace, "add", "made.txt"]);
        execFileSync("git", ["-C", workspace, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "work"]);
        assert.equal((await exec(provider, id, ["cat", "/workspace/made.txt"])).stdout, "work\n");
        assert.notEqual((await exec(provider, id, ["sh", "-c", "echo x > /workspace/.git"])).exitCode, 0, ".git is read-only");
        const outcome = await provider.destroy(id);
        assert.equal(outcome.branch?.name, "sandbox/contract");
        assert.equal(outcome.branch?.commit, git("rev-parse", "sandbox/contract"));
        assert.equal(git("show", "sandbox/contract:made.txt"), "work");
        assert.ok(!existsSync(workspace));
      } finally {
        await provider.destroy(id);
        await rm(repo, { recursive: true, force: true });
      }
    });

    test("a snapshot restores into a new sandbox", async (t) => {
      if (!provider.capabilities.snapshot || !provider.snapshot) return t.skip("no snapshots");
      const id = await fresh();
      const { snapshotId } = await (async () => {
        try {
          await exec(provider, id, ["sh", "-c", "echo kept > /workspace/k; echo home > ~/h"]);
          return await provider.snapshot!(id);
        } finally {
          await provider.destroy(id);
        }
      })();
      const restored = await fresh({ workspace: { snapshot: snapshotId } });
      try {
        assert.equal((await exec(provider, restored, ["sh", "-c", "cat /workspace/k ~/h"])).stdout, "kept\nhome\n");
      } finally {
        await provider.destroy(restored);
      }
    });

    test("destroy is total and idempotent", async () => {
      const id = await fresh();
      await provider.destroy(id);
      await provider.destroy(id);
      assert.ok(!(await provider.list()).includes(id));
      await assert.rejects(exec(provider, id, ["true"]));
    });
  });
}

test("a symlink planted on the host side of a bind workspace cannot widen it", async (t) => {
  const provider = providers.bwrap;
  if (unavailable.bwrap()) return t.skip(unavailable.bwrap() as string);
  const dir = await mkdtemp(join(tmpdir(), "sandbox-bind-"));
  await symlink("/etc", join(dir, "etc"));
  const id = `sb-contract-${(n += 1)}`;
  await provider.create(id, spec({ workspace: { bind: { path: dir } } }));
  try {
    await assert.rejects(provider.readFile(id, "etc/passwd"));
  } finally {
    await provider.destroy(id);
    await rm(dir, { recursive: true, force: true });
  }
});
