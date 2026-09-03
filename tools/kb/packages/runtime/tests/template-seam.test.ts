import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { KbContext } from "@kb/contracts";
import { invoke } from "../src/invoke.ts";
import { registryFor, resetRegistryCache } from "../src/registry.ts";
import { openKb } from "../src/session.ts";

/**
 * The template seam: a `.kb/extensions/*.ts` module contributes a render
 * template exactly the way it contributes an action — default-exported
 * definition, namespaced `ext.<file>.<template>`, resolved by the registry —
 * and `docs.materialize` renders a view through it.
 */

const TAG_ID = "01TESTTAGSHOUT000000000000";
const NODE_ID = "01TESTNODESHOUT00000000000";

const SHOUT_QUERY =
  '[:find ?id :where [?n :f/sys.f.type ?tag] [?tag :node/text "shoutable"] [?tag :f/sys.f.type ?tagType] [?tagType :node/id "sys.tag"] [?n :node/id ?id]]';

const SHOUT_EXTENSION = `const shout = {
  id: "shout",
  template(rows, ctx) {
    const lines = rows
      .map((row) => String(ctx.nodes.get(row[0])?.text ?? row[0]).toUpperCase())
      .toSorted()
      .map((text) => "- " + text);
    return ["# Shout", "", ...lines].join("\\n");
  },
};

export default [shout];
`;

let roots: string[] = [];

const cleanupEffect = Effect.fn("test.cleanup")(function* () {
  for (const root of roots) {
    yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
  }
  roots = [];
  resetRegistryCache();
});

afterEach(() => Effect.runPromise(cleanupEffect()));

const mustInvokeEffect = Effect.fn("test.mustInvoke")(function* (
  ctx: KbContext,
  id: string,
  input: unknown,
) {
  const receipt = yield* Effect.promise(() => invoke(ctx, { id, input }));
  expect(receipt).toMatchObject({ status: "succeeded" });
  return receipt;
});

/** A kb root carrying one `.kb/extensions` template and a view that uses it. */
const seedShoutRootEffect = Effect.fn("test.seedShoutRoot")(function* () {
  const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "kb-template-seam-")));
  roots.push(root);

  yield* Effect.promise(() => mkdir(join(root, ".kb", "extensions"), { recursive: true }));
  yield* Effect.promise(() =>
    writeFile(join(root, ".kb", "extensions", "loud.ts"), SHOUT_EXTENSION, "utf8"),
  );
  yield* Effect.promise(() => mkdir(join(root, ".kb", "views"), { recursive: true }));
  yield* Effect.promise(() =>
    writeFile(
      join(root, ".kb", "views", "shout.json"),
      JSON.stringify({
        output: "docs/kb/shout.md",
        query: SHOUT_QUERY,
        template: "ext.loud.shout",
      }),
      "utf8",
    ),
  );

  const ctx = yield* Effect.promise(() => openKb(root));
  yield* mustInvokeEffect(ctx, "tag.define", { name: "shoutable", id: TAG_ID });
  yield* mustInvokeEffect(ctx, "node.add", {
    id: NODE_ID,
    text: "hello seam",
    tags: ["shoutable"],
  });
  return { root, ctx };
});

describe("extension-contributed render templates", () => {
  test("a .kb/extensions module contributes a template under ext.<file>.<template>", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { root } = yield* seedShoutRootEffect();
        const registry = yield* Effect.promise(() => registryFor(root));

        expect(registry.failures).toEqual([]);
        expect([...registry.templates.keys()]).toContain("ext.loud.shout");
        expect(registry.extensions.find((e) => e.name === "loud")?.templates).toMatchObject([
          { id: "ext.loud.shout", source: "ext:loud" },
        ]);
      }),
    ));

  test("docs.materialize renders a view through the extension's template", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { root, ctx } = yield* seedShoutRootEffect();

        const receipt = yield* mustInvokeEffect(ctx, "docs.materialize", { view: "shout" });
        expect(receipt).toMatchObject({
          output: { written: [{ view: "shout", output: "docs/kb/shout.md" }] },
        });

        const content = yield* Effect.promise(() =>
          readFile(join(root, "docs/kb/shout.md"), "utf8"),
        );
        expect(content).toContain("# Shout");
        expect(content).toContain("- HELLO SEAM");
      }),
    ));

  test("the bundled docs templates keep their bare ids as aliases", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { root } = yield* seedShoutRootEffect();
        const registry = yield* Effect.promise(() => registryFor(root));

        expect(registry.templates.has("ext.docs.todos")).toBe(true);
        expect(registry.templates.get("todos")).toBe(registry.templates.get("ext.docs.todos"));
      }),
    ));

  test("an unknown template names the registered ids", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { root, ctx } = yield* seedShoutRootEffect();
        yield* Effect.promise(() =>
          writeFile(
            join(root, ".kb", "views", "nope.json"),
            JSON.stringify({ output: "docs/kb/nope.md", query: SHOUT_QUERY, template: "nope" }),
            "utf8",
          ),
        );

        const receipt = yield* Effect.promise(() =>
          invoke(ctx, { id: "docs.check", input: { view: "nope" } }),
        );
        expect(receipt).toMatchObject({
          status: "failed",
          code: "invalid_input",
          details: { known: expect.arrayContaining(["ext.loud.shout"]) },
        });
      }),
    ));
});
