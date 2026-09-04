import { describe, expect, test } from "bun:test";
import { specifiersOf } from "../src/import-graph.ts";

/**
 * Harness check: import extraction is a parse, not a scan (wave t2).
 *
 * `boundaries` is only as honest as the edges it is given, and the regex this
 * replaced asked the wrong question: it matched the word `from`, so a
 * side-effect `import "@kb/x"` produced no edge at all and `export { x } from
 * "@kb/y"` produced one only because that word happens to appear. A fence with
 * an invisible form is not a fence — you can cross it by choosing a syntax.
 *
 * Red case: put the old `/(?:\bfrom\s*|…)/` back and the first two
 * expectations below fail.
 */
describe("import-graph", () => {
  test("a side-effect import and an `export … from` are both sites", () => {
    const source = `import "@kb/side-effect";
export { x } from "@kb/reexport";
`;
    expect(specifiersOf("fixture.ts", source)).toEqual(["@kb/side-effect", "@kb/reexport"]);
  });

  test("every other import form the workspace can write is a site", () => {
    const source = `import { a } from "@kb/named";
import type { B } from "@kb/type-only";
import * as ns from "@kb/namespace";
export * from "@kb/star";
export * as bag from "@kb/star-as";
const lazy = await import("@kb/dynamic");
void lazy;
void ns;
`;
    expect(specifiersOf("fixture.ts", source).toSorted()).toEqual([
      "@kb/dynamic",
      "@kb/named",
      "@kb/namespace",
      "@kb/star",
      "@kb/star-as",
      "@kb/type-only",
    ]);
  });

  test("a specifier named only in a comment or a string is not a site", () => {
    const source = `// import { a } from "@kb/commented";
/* export { b } from "@kb/blocked"; */
const s = 'import { c } from "@kb/quoted"';
void s;
`;
    expect(specifiersOf("fixture.ts", source)).toEqual([]);
  });

  test("a computed dynamic import contributes no specifier", () => {
    const source = `const which = "@kb/model";
const m = await import(which);
void m;
`;
    expect(specifiersOf("fixture.ts", source)).toEqual([]);
  });

  test("tsx parses as tsx", () => {
    const source = `import { Thing } from "@kb/ui-bits";
export const El = () => <Thing<string> value="x" />;
`;
    expect(specifiersOf("fixture.tsx", source)).toEqual(["@kb/ui-bits"]);
  });

  test("a file that does not parse fails loudly rather than reporting no imports", () => {
    expect(() => specifiersOf("broken.ts", "import { from '@kb/x'\n")).toThrow("broken.ts");
  });
});
