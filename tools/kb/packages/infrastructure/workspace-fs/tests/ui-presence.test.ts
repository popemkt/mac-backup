/**
 * Which `kb ui` serves a root: presence says where one was, and only the
 * server's own answer for this root counts (`servingUi`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { clearUiPresence, readUiPresence, servingUi, writeUiPresence } from "../src/index.ts";

const roots: string[] = [];
const servers: { stop: (force: boolean) => unknown }[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) void server.stop(true);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function scratchRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kb-presence-"));
  await mkdir(join(root, ".kb"));
  roots.push(root);
  return root;
}

/** A server that says it serves `root`. */
function identityServer(root: string): string {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ root }),
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(BunFileSystem.layer)));

describe("servingUi", () => {
  test("a root with no presence is served by nothing", async () => {
    expect(await run(servingUi(await scratchRoot()))).toBeNull();
  });

  test("presence whose server answers for this root names that server", async () => {
    const root = await scratchRoot();
    const url = identityServer(await realpath(root));
    await run(writeUiPresence(root, url));
    expect(await run(servingUi(root))).toBe(url);
  });

  test("presence whose server answers for another root, or nothing at all, is not trusted", async () => {
    const root = await scratchRoot();
    await run(writeUiPresence(root, identityServer("/elsewhere")));
    expect(await run(servingUi(root))).toBeNull();
    const gone = await scratchRoot();
    await run(writeUiPresence(gone, "http://127.0.0.1:9"));
    expect(await run(servingUi(gone))).toBeNull();
  });

  test("presence naming anything but a kb ui on this machine is not read, nor asked", async () => {
    const root = await scratchRoot();
    let asked = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        asked++;
        return Response.json({ root });
      },
    });
    servers.push(server);
    const at = `http://127.0.0.1:${server.port}`;
    for (const url of [
      `${at}/elsewhere`,
      `${at}?next=https://example.com`,
      `http://user:pw@127.0.0.1:${server.port}`,
      "http://127.0.0.1",
      `https://127.0.0.1:${server.port}`,
      "http://example.com:80",
      "http://10.0.0.1:4321",
      "javascript:alert(1)",
    ]) {
      const forged = { url, pid: process.pid, root: await realpath(root) };
      await writeFile(join(root, ".kb", "ui.json"), JSON.stringify(forged));
      expect(await run(readUiPresence(root))).toBeNull();
      expect(await run(servingUi(root))).toBeNull();
    }
    expect(asked).toBe(0);
  });

  test("a server writes presence only for an address on this machine", async () => {
    const root = await scratchRoot();
    const refused = await run(Effect.flip(writeUiPresence(root, "http://0.0.0.0:4321")));
    expect(refused.code).toBe("invalid_input");
    expect(await run(readUiPresence(root))).toBeNull();
  });
});

describe("clearUiPresence", () => {
  test("removes the file this process's server wrote", async () => {
    const root = await scratchRoot();
    await run(writeUiPresence(root, "http://127.0.0.1:4321"));
    await run(clearUiPresence(root, "http://127.0.0.1:4321"));
    expect(await run(readUiPresence(root))).toBeNull();
  });

  test("leaves a file another server wrote, at another URL or from another process at the same one", async () => {
    const root = await scratchRoot();
    await run(writeUiPresence(root, "http://127.0.0.1:4322"));
    await run(clearUiPresence(root, "http://127.0.0.1:4321"));
    expect(await run(readUiPresence(root))).not.toBeNull();
    const reused = {
      url: "http://127.0.0.1:4321",
      pid: process.pid + 1,
      root: await realpath(root),
    };
    await writeFile(join(root, ".kb", "ui.json"), JSON.stringify(reused));
    await run(clearUiPresence(root, "http://127.0.0.1:4321"));
    expect(await run(readUiPresence(root))).toEqual(reused);
  });
});
