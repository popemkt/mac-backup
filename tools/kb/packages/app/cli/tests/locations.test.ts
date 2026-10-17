/**
 * `kb locations` and the roots a person opens: `kb init` registers the root
 * it makes, and the commands list, add and forget locations in the home
 * store `KB_HOME` names, which each test makes its own.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pointHomeAt } from "@kb/test-kit";
import { main } from "../src/cli.ts";

let scratch: string;
let restoreHome: () => void;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), "kb-cli-locations-")));
  restoreHome = pointHomeAt(join(scratch, "home"));
});

afterEach(async () => {
  restoreHome();
  process.exitCode = 0;
  await rm(scratch, { recursive: true, force: true });
});

async function kb(root: string, args: string[]): Promise<{ code: number; stdout: string }> {
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

async function initRoot(name: string): Promise<string> {
  const root = join(scratch, name);
  await mkdir(root);
  expect((await kb(root, ["init", "--bare"])).code).toBe(0);
  return root;
}

describe("kb locations", () => {
  test("kb init registers the root it makes, and kb locations lists it as the current one", async () => {
    const root = await initRoot("alpha");
    const listed = await kb(root, ["locations"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toBe(`* alpha\tclosed\t${root}\n`);
    const json = JSON.parse((await kb(root, ["--json", "locations"])).stdout);
    expect(json.status).toBe("succeeded");
    expect(json.output.rows).toEqual([
      expect.objectContaining({ label: "alpha", path: root, current: true, status: "closed" }),
    ]);
  });

  test("add ranks a root first under its label, and forget removes it by label, leaving its files", async () => {
    const alpha = await initRoot("alpha");
    const beta = await initRoot("beta");
    expect((await kb(alpha, ["locations", "add", beta, "--label", "Beta"])).code).toBe(0);
    const listed = (await kb(alpha, ["locations"])).stdout.split("\n").filter(Boolean);
    expect(listed.map((line) => line.split("\t")[0])).toEqual(["  Beta", "* alpha"]);

    const files = await readdir(join(beta, ".kb"));
    const forgot = await kb(alpha, ["locations", "forget", "Beta"]);
    expect(forgot).toEqual({ code: 0, stdout: `forgot Beta  ${beta}\n` });
    expect(await readdir(join(beta, ".kb"))).toEqual(files);
    expect((await kb(alpha, ["locations"])).stdout).toBe(`* alpha\tclosed\t${alpha}\n`);
  });

  test("a root that holds no store is refused, and forgetting what is not listed fails", async () => {
    const alpha = await initRoot("alpha");
    const plain = join(scratch, "plain");
    await mkdir(plain);
    const refused = await kb(alpha, ["--json", "locations", "add", plain]);
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({ status: "failed", code: "not_found" });
    const unknown = await kb(alpha, ["--json", "locations", "forget", "nothing"]);
    expect(unknown.code).toBe(1);
    expect(JSON.parse(unknown.stdout)).toMatchObject({ code: "not_found" });
  });
});

describe("kb open", () => {
  test("a served location opens at its server's URL, by label or by path", async () => {
    const alpha = await initRoot("alpha");
    const beta = await initRoot("beta");
    await kb(alpha, ["locations", "add", beta]);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ root: beta }),
    });
    try {
      const url = `http://127.0.0.1:${server.port}`;
      await writeFile(
        join(beta, ".kb", "ui.json"),
        JSON.stringify({ url, pid: process.pid, root: beta }),
      );
      expect(await kb(alpha, ["open", "beta", "--no-browser"])).toEqual({
        code: 0,
        stdout: `${url}\n`,
      });
      expect((await kb(alpha, ["open", beta, "--no-browser"])).stdout).toBe(`${url}\n`);
      expect((await kb(alpha, ["locations"])).stdout.split("\t")[0]).toBe("  beta");
    } finally {
      void server.stop(true);
    }
  });

  test("a path that holds no store is refused, and nothing is started", async () => {
    const alpha = await initRoot("alpha");
    const plain = join(scratch, "plain");
    await mkdir(plain);
    const refused = await kb(alpha, ["--json", "open", plain, "--no-browser"]);
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({ status: "failed", code: "not_found" });
    expect(await readdir(plain)).toEqual([]);
  });
});
