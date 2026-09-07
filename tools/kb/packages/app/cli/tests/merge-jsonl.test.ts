/**
 * The git merge driver, end to end through git itself.
 *
 * `mergeNodeSets` owns the resolution rules and is tested in @kb/model. What
 * is unproven until git runs it is the wiring: that `.gitattributes` selects
 * the driver, that git's `%O %A %B %P` reach it in that order, that the result
 * is read back from `%A`, and that the exit status is what marks the path
 * resolved or conflicted.
 *
 * Red case: swap `%A` and `%B` in the driver line below — the "their append"
 * case then loses their node.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJsonl, type KbNode } from "@kb/model";

const DRIVER = resolve(import.meta.dir, "../src/bin/merge-jsonl.ts");

function node(id: string, text: string, updatedAt = "2026-01-01T00:00:00.000Z"): KbNode {
  return {
    id,
    text,
    props: {},
    children: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  };
}

let repo: string;

async function git(...args: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, GIT_CONFIG_NOSYSTEM: "1", HOME: repo },
  });
  const stderr = await new Response(proc.stderr).text();
  return { code: await proc.exited, stderr };
}

const STORE = ".kb/nodes.jsonl";

async function writeStore(nodes: KbNode[]): Promise<void> {
  await writeFile(join(repo, STORE), canonicalJsonl(nodes));
}

async function readStore(): Promise<string> {
  return readFile(join(repo, STORE), "utf8");
}

/** A repo with the driver configured exactly as tools/kb/AGENTS.md documents. */
async function setUpRepo(): Promise<void> {
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "merge.kb-jsonl.name", "kb node store (three-way by node id)");
  await git("config", "merge.kb-jsonl.driver", `bun ${DRIVER} %O %A %B %P`);
  await mkdir(join(repo, ".kb"), { recursive: true });
  await writeFile(join(repo, ".gitattributes"), `${STORE} merge=kb-jsonl\n`);
}

/** Commit `nodes` on a branch cut from `main`, then return to main. */
async function branchWith(name: string, nodes: KbNode[]): Promise<void> {
  await git("checkout", "-q", "-b", name, "main");
  await writeStore(nodes);
  await git("commit", "-qam", name);
  await git("checkout", "-q", "main");
}

describe("nodes.jsonl merge driver", () => {
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "kb-merge-"));
    await setUpRepo();
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  test("two branches each appending a node merge without a conflict", async () => {
    const base = node("01AAA", "a");
    await writeStore([base]);
    await git("add", "-A");
    await git("commit", "-qm", "base");

    await branchWith("theirs", [base, node("01THEIR", "from their branch")]);
    await writeStore([base, node("01OUR", "from our branch")]);
    await git("commit", "-qam", "ours");

    const merge = await git("merge", "--no-edit", "theirs");

    expect(merge.stderr).toBe("");
    expect(merge.code).toBe(0);
    const lines = (await readStore()).trimEnd().split("\n");
    expect(lines.map((l) => (JSON.parse(l) as KbNode).id)).toEqual(["01AAA", "01OUR", "01THEIR"]);
  });

  test("only their side changed: the merged file is their file, byte for byte", async () => {
    const base = [node("01AAA", "a"), node("01BBB", "b")];
    await writeStore(base);
    await git("add", "-A");
    await git("commit", "-qm", "base");

    const theirNodes = [node("01AAA", "a"), node("01BBB", "b, edited", "2026-02-01T00:00:00.000Z")];
    await branchWith("theirs", theirNodes);
    // Our side commits something else, so this is a real merge, not a fast-forward.
    await writeFile(join(repo, "unrelated.txt"), "ours\n");
    await git("add", "-A");
    await git("commit", "-qm", "ours");

    expect((await git("merge", "--no-edit", "theirs")).code).toBe(0);
    expect(await readStore()).toBe(canonicalJsonl(theirNodes));
  });

  test("their deletion of a node we did not touch is honoured", async () => {
    const base = [node("01AAA", "a"), node("01BBB", "b")];
    await writeStore(base);
    await git("add", "-A");
    await git("commit", "-qm", "base");

    await branchWith("theirs", [node("01AAA", "a")]);
    await writeStore([...base, node("01OUR", "ours")]);
    await git("commit", "-qam", "ours");

    expect((await git("merge", "--no-edit", "theirs")).code).toBe(0);
    const lines = (await readStore()).trimEnd().split("\n");
    expect(lines.map((l) => (JSON.parse(l) as KbNode).id)).toEqual(["01AAA", "01OUR"]);
  });

  test("both changed the same node: the newer updatedAt wins", async () => {
    await writeStore([node("01BBB", "b")]);
    await git("add", "-A");
    await git("commit", "-qm", "base");

    await branchWith("theirs", [node("01BBB", "theirs", "2026-02-01T00:00:00.000Z")]);
    await writeStore([node("01BBB", "ours", "2026-03-01T00:00:00.000Z")]);
    await git("commit", "-qam", "ours");

    expect((await git("merge", "--no-edit", "theirs")).code).toBe(0);
    expect((JSON.parse((await readStore()).trim()) as KbNode).text).toBe("ours");
  });

  test("a deletion racing an edit stops the merge and names the node", async () => {
    await writeStore([node("01BBB", "b")]);
    await git("add", "-A");
    await git("commit", "-qm", "base");

    await branchWith("theirs", [node("01BBB", "theirs", "2026-02-01T00:00:00.000Z")]);
    await writeStore([]);
    await git("commit", "-qam", "ours");

    const merge = await git("merge", "--no-edit", "theirs");

    expect(merge.code).not.toBe(0);
    expect(merge.stderr).toContain("01BBB: deleted-and-modified");
    // Whatever git leaves in the worktree still loads as a node store.
    const body = await readStore();
    for (const line of body.trimEnd().split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
