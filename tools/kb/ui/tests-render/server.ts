import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startUi } from "../../src/surface/ui/server.ts";
import { renderFixtureNodes } from "./fixture.ts";

const repoRoot = resolve(import.meta.dir, "../../../..");
const scratchRoot = await mkdtemp(join(tmpdir(), "kb-render-harness-"));
const sourceKb = join(repoRoot, ".kb");
const scratchKb = join(scratchRoot, ".kb");

await cp(sourceKb, scratchKb, { recursive: true });
const sourceNodes = (await readFile(join(scratchKb, "nodes.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { id: string });
const systemNodes = sourceNodes.filter((node) => node.id.startsWith("sys."));
const fixtureNodes = [...systemNodes, ...renderFixtureNodes()];
await writeFile(
  join(scratchKb, "nodes.jsonl"),
  `${fixtureNodes.map((node) => JSON.stringify(node)).join("\n")}\n`,
);

const server = await startUi({
  root: scratchRoot,
  port: 4323,
  openBrowser: false,
});
console.log(`render harness UI: ${server.url} (scratch root: ${scratchRoot})`);

const stop = async () => {
  await server.stop();
  await rm(scratchRoot, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
await new Promise(() => {});
