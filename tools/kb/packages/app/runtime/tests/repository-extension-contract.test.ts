/**
 * A repository extension is a family like a bundled one: a module in
 * `.kb/extensions` that exports its declaration keeps the one extension
 * contract, the registry its host, over a root that holds it. Its node, its
 * switch and its setting are that store's nodes, seeded from its
 * declaration.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { FIELD_TYPE_OPTION_IDS, SYSTEM_IDS, extensionNodeId } from "@kb/model";
import {
  extensionContract,
  writeExtension,
  writeTrustedExtension,
  type SwitchingHost,
} from "@kb/test-kit";
import { rootFamilies } from "../src/families.ts";
import { invoke } from "../src/invoke.ts";
import { bunFileSystemLayer } from "../src/platform.ts";
import { registryFor, resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

const SETTING = "sys.f.fixture.greeting";

/** The fixture: an optional family with one setting on its node and one template. */
const FIXTURE = `
export const declaration = {
  name: "fixture",
  label: "Fixture",
  optional: { byDefault: "on" },
  seed: (at) => [
    {
      id: ${JSON.stringify(SETTING)},
      text: "greeting",
      props: {
        ${JSON.stringify(SYSTEM_IDS.typeField)}: [{ t: "ref", v: ${JSON.stringify(SYSTEM_IDS.field)} }],
        ${JSON.stringify(SYSTEM_IDS.fieldTypeField)}: [{ t: "ref", v: ${JSON.stringify(FIELD_TYPE_OPTION_IDS.text)} }],
        ${JSON.stringify(SYSTEM_IDS.configuresField)}: [{ t: "ref", v: ${JSON.stringify(extensionNodeId("fixture"))} }],
      },
      children: [],
      createdAt: at,
      updatedAt: at,
    },
  ],
};
export default [{ id: "hello", template: () => "hello" }];
`;

/** A fresh root whose `.kb/extensions` holds `modules`, by file name, each trusted here. */
async function rootWith(modules: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kb-repository-extension-"));
  for (const [file, text] of Object.entries(modules)) {
    await writeTrustedExtension(root, file, text);
  }
  return root;
}

const FIXTURE_ROOT = await rootWith({ "fixture.ts": FIXTURE });
afterAll(() => rm(FIXTURE_ROOT, { recursive: true, force: true }));

const discovered = await Effect.runPromise(
  rootFamilies(FIXTURE_ROOT).pipe(Effect.provide(bunFileSystemLayer)),
);
const fixture = discovered.families.find(({ declaration }) => declaration.name === "fixture");
if (fixture === undefined)
  throw new Error(`the fixture was not discovered: ${JSON.stringify(discovered.failures)}`);

/** The registry over a root that holds the fixture, as its host. */
const repositoryHost: SwitchingHost = {
  source: "registry",
  root: Effect.acquireRelease(
    Effect.promise(() => rootWith({ "fixture.ts": FIXTURE })),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  ),
  compose: (nodeOf) =>
    registryFor(FIXTURE_ROOT, nodeOf).pipe(
      Effect.map(({ families, kernel }) => ({
        row: families.find((family) => family.name === "fixture"),
        kernel,
      })),
      Effect.provide(bunFileSystemLayer),
    ),
};

extensionContract(fixture.declaration, fixture.entry, repositoryHost);

describe("a repository extension's node", () => {
  test("is its store's: seeded with its setting, switched and configured like a bundled family's", async () => {
    const root = await rootWith({ "fixture.ts": FIXTURE });
    try {
      const ctx = await openKb(root);
      const node = ctx.index.getNode(extensionNodeId("fixture"));
      expect(node).toMatchObject({ text: "Fixture", props: {} });
      expect(ctx.index.getNode(SYSTEM_IDS.extensionsRoot)?.children).toContain(node?.id);
      // Its setting is written on its node like any field, though the node is `sys.*`.
      const set = await invoke(ctx, {
        id: "node.update",
        input: {
          id: extensionNodeId("fixture"),
          setProps: [{ field: SETTING, value: { t: "str", v: "hi" } }],
        },
      });
      expect(set.status).toBe("succeeded");
      const off = await invoke(ctx, {
        id: "extension.switch",
        input: { name: "fixture", on: false },
      });
      expect(off.status).toBe("succeeded");
      expect(ctx.index.getNode(extensionNodeId("fixture"))?.props).toEqual({
        [SETTING]: [{ t: "str", v: "hi" }],
        [SYSTEM_IDS.extensionEnabledField]: [{ t: "bool", v: false }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a module no one trusted here seeds nothing: its node is not in the store", async () => {
    const root = await mkdtemp(join(tmpdir(), "kb-repository-extension-"));
    try {
      await writeExtension(root, "fixture.ts", FIXTURE);
      const ctx = await openKb(root);
      expect(ctx.index.getNode(extensionNodeId("fixture"))).toBeUndefined();
      expect(ctx.index.getNode(SETTING)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a module whose declaration does not fold is refused, and the store still opens", async () => {
    resetRegistryCache();
    const root = await rootWith({
      "graph.ts":
        'export const declaration = { name: "graph", label: "Mine" };\nexport default [];\n',
    });
    try {
      const { families, failures } = await Effect.runPromise(
        rootFamilies(root).pipe(Effect.provide(bunFileSystemLayer)),
      );
      expect(families.filter(({ source }) => source !== "bundled")).toEqual([]);
      expect(failures.map(({ file, error }) => [file, error.includes("declared twice")])).toEqual([
        ["graph.ts", true],
      ]);
      const ctx = await openKb(root);
      expect(ctx.index.getNode(extensionNodeId("graph"))?.text).toBe("Graph");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
