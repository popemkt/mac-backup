/**
 * Which `kb ui` serves a root: presence says where one was, and only the
 * server's own answer for this root counts (`servingUi`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { FileSystem } from "effect/FileSystem";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { servingUi, writeUiPresence } from "../src/index.ts";

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
});
