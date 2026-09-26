import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { systemSeedNodes } from "@kb/model";
import { startUi } from "@kb/server";
import { FIXTURE_TIMESTAMP, renderFixtureNodes } from "./fixture.ts";

/*
 * The store a spec sees is the system seed plus the render fixture, and
 * nothing else. It is built from `systemSeedNodes()` rather than copied from
 * the working tree's `.kb`, so what a spec counts cannot move when someone
 * adds a node to the repo's knowledge base.
 */
const scratchRoot = await mkdtemp(join(tmpdir(), "kb-render-harness-"));
const scratchKb = join(scratchRoot, ".kb");
await mkdir(scratchKb);
const fixtureNodes = [...systemSeedNodes(FIXTURE_TIMESTAMP), ...renderFixtureNodes()];
await writeFile(
  join(scratchKb, "nodes.jsonl"),
  `${fixtureNodes.map((node) => JSON.stringify(node)).join("\n")}\n`,
);

const server = await Effect.runPromise(
  startUi({
    root: scratchRoot,
    // Per-spec port: a spec that writes must not share a store with one that
    // counts (see harness-server.ts).
    port: Number(process.argv[2] ?? 4323),
    openBrowser: false,
  }),
);
console.log(`render harness UI: ${server.url} (scratch root: ${scratchRoot})`);

const stop = async () => {
  await Effect.runPromise(server.stop);
  await rm(scratchRoot, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise(() => {});
