/**
 * `renderText`: a docs template's refs rendered as words. It reads tokens
 * with the one grammar (`@kb/model`'s mention.ts), so it sees exactly the
 * tokens the `:node/mentions` datoms see — the rendering half of the
 * extraction property in model's `mention.property.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { KbNode } from "@kb/model";
import { renderText, type TemplateContext } from "../src/template.ts";

function context(nodes: Array<Pick<KbNode, "id" | "text">>): TemplateContext {
  return {
    nodes: new Map(
      nodes.map((n) => [n.id, { ...n, props: {}, children: [], createdAt: "", updatedAt: "" }]),
    ),
    fieldIdByName: () => undefined,
  };
}

describe("renderText", () => {
  test("a stray [ before a token does not swallow it", () => {
    const ctx = context([{ id: "a", text: "Alpha" }]);
    expect(renderText("[[[a]]", ctx)).toBe("[Alpha");
    expect(renderText("the [[ trigger; a typed [[a|label]] still", ctx)).toBe(
      "the [[ trigger; a typed label still",
    );
  });

  test("renders each token as its non-empty label, else its target's text, else its id; text between is kept", () => {
    const idArb = fc.stringMatching(/^[a-z0-9._-]{1,8}$/);
    const plainArb = fc.string({ maxLength: 12 }).filter((s) => !/[[\]|]/.test(s));
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: idArb,
            // An empty label (`[[id|]]`) renders like no label at all.
            label: fc.option(plainArb, { nil: undefined }),
            known: fc.boolean(),
          }),
          { maxLength: 10 },
        ),
        fc.array(plainArb, { minLength: 11, maxLength: 11 }),
        (tokens, gaps) => {
          const known = tokens.filter((t) => t.known).map((t) => ({ id: t.id, text: `<${t.id}>` }));
          const ctx = context(known);
          const has = new Set(known.map((n) => n.id));
          let text = gaps[0] ?? "";
          let expected = gaps[0] ?? "";
          tokens.forEach((t, i) => {
            text +=
              (t.label === undefined ? `[[${t.id}]]` : `[[${t.id}|${t.label}]]`) +
              (gaps[i + 1] ?? "");
            const named = t.label !== undefined && t.label.length > 0 ? t.label : undefined;
            expected += (named ?? (has.has(t.id) ? `<${t.id}>` : t.id)) + (gaps[i + 1] ?? "");
          });
          expect(renderText(text, ctx)).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});
