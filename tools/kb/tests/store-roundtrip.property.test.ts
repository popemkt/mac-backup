/**
 * Store round trip (fast-check): for any generated valid node set, write to
 * nodes.jsonl and read back — identical nodes, identical order, no key
 * invented and none dropped. Never touches the owner's live store; every run
 * gets its own scratch temp root, cleaned up immediately after.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KbNode, PropValue } from "../src/foundation/model.ts";
import { JsonlStore } from "../src/foundation/storage/index.ts";

const AT = "2026-01-01T00:00:00.000Z";

const propValueArb: fc.Arbitrary<PropValue> = fc.oneof(
  fc.record({ t: fc.constant("str" as const), v: fc.string() }),
  fc.record({
    t: fc.constant("num" as const),
    v: fc.double({ noNaN: true, noDefaultInfinity: true, min: -1e9, max: 1e9 }),
  }),
  fc.record({ t: fc.constant("bool" as const), v: fc.boolean() }),
  fc.record({ t: fc.constant("date" as const), v: fc.string() }),
  fc.record({ t: fc.constant("ref" as const), v: fc.string() }),
);

/** A KbNode plus a chance of an unknown top-level key, matching real drift
 * (a field the store must have kept even before this loader knew its shape). */
const nodeArb = fc
  .record({
    id: fc.stringMatching(/^n[a-z0-9-]{1,12}$/),
    text: fc.string(),
    props: fc.dictionary(
      // Real field ids are ULIDs or `sys.*` identifiers, never a magic own
      // property name — `__proto__` on a plain `{}` sets the prototype
      // instead of an own key, which is a JS object-literal footgun, not a
      // store bug (canonicalJson defends against it too; see storage fix).
      fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s !== "__proto__"),
      fc.array(propValueArb, { minLength: 0, maxLength: 3 }),
    ),
    children: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 4 }),
    extra: fc.option(fc.string(), { nil: undefined }),
  })
  .map(({ id, text, props, children, extra }) => {
    const node: KbNode & { legacyField?: string } = {
      id,
      text,
      props,
      children,
      createdAt: AT,
      updatedAt: AT,
    };
    if (extra !== undefined) node.legacyField = extra;
    return node;
  });

describe("JsonlStore round trip (fast-check)", () => {
  test("write then read: identical nodes, identical order, no key invented or dropped", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(nodeArb, { selector: (n) => n.id, minLength: 0, maxLength: 15 }),
        async (nodes) => {
          const root = await mkdtemp(join(tmpdir(), "kb-store-prop-"));
          try {
            const store = new JsonlStore(root);
            await store.commit({ upserts: nodes, deletes: [] });
            const loaded = await store.load();

            const sortedIds = nodes.map((n) => n.id).sort();
            expect(loaded.map((n) => n.id)).toEqual(sortedIds);

            const byId = new Map(nodes.map((n) => [n.id, n]));
            for (const loadedNode of loaded) {
              expect(loadedNode).toEqual(byId.get(loadedNode.id)!);
            }
          } finally {
            await rm(root, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
