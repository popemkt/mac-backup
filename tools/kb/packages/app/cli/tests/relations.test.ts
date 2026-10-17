/**
 * `kb trace`, `kb suggest` and `kb relate` over a scratch root: each prints
 * what the graph family's action answers, one sentence per hop, and `kb
 * relate` types a mention without touching its text. The actions' own
 * promises are the runtime's and `@kb/graph`'s tests.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pointHomeAt } from "@kb/test-kit";
import { main } from "../src/cli.ts";

let scratch: string;
let root: string;
let restoreHome: () => void;

async function kb(args: string[]): Promise<{ code: number; stdout: string }> {
  const stdout: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  process.stderr.write = () => true;
  try {
    process.exitCode = 0;
    const code = await main(["bun", "kb", "--root", root, ...args]);
    return { code, stdout: stdout.join("") };
  } finally {
    process.stdout.write = write;
    process.stderr.write = errWrite;
  }
}

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), "kb-cli-relations-")));
  restoreHome = pointHomeAt(join(scratch, "home"));
  root = join(scratch, "root");
  await mkdir(root);
  expect((await kb(["init", "--bare"])).code).toBe(0);
  for (const args of [
    ["field", "define", "influences", "--id", "f.influences"],
    ["field", "type", "f.influences", "ref"],
    ["add", "B", "--id", "b"],
    ["add", "C", "--id", "c", "--parent", "b"],
    ["add", "A on [[b|B]]", "--id", "a"],
    ["add", "E on [[b]]", "--id", "e"],
  ])
    expect((await kb(args)).code).toBe(0);
});

afterEach(async () => {
  restoreHome();
  process.exitCode = 0;
  await rm(scratch, { recursive: true, force: true });
});

describe("kb trace, kb suggest, kb relate", () => {
  test("kb trace prints each path's hops as sentences", async () => {
    const { code, stdout } = await kb(["trace", "a", "c"]);
    expect(code).toBe(0);
    expect(stdout.split("\n")).toEqual([
      "1. 2 hops",
      "   A on B mentions B",
      "   B contains C",
      "",
    ]);
  });

  test("kb suggest prints the related nodes nothing connects", async () => {
    const { code, stdout } = await kb(["suggest", "a"]);
    expect(code).toBe(0);
    expect(stdout).toContain("[e]");
    expect(stdout).toContain("[c]");
  });

  test("kb relate types the relation once, and kb trace then names it", async () => {
    const first = await kb(["relate", "a", "b", "f.influences"]);
    expect(first.stdout.trim()).toBe("typed a —f.influences→ b");
    const again = await kb(["relate", "a", "b", "f.influences"]);
    expect(again.stdout.trim()).toBe("already typed a —f.influences→ b");
    const traced = await kb(["trace", "a", "b", "--kinds", "prop:f.influences", "--json"]);
    const output = JSON.parse(traced.stdout).output;
    expect(output.paths[0].hops[0].sentence).toBe("A on B —influences→ B");
    const missing = await kb(["relate", "a", "nope", "f.influences"]);
    expect(missing.code).toBe(1);
  });
});
