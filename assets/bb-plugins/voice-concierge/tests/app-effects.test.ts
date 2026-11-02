// React calls whatever an effect returns as its cleanup. An expression-bodied effect hands React the expression's
// value, and a DOM call that returns a Promise (current Chromium's scrollIntoView) then crashes the page with
// "l is not a function" the next time the effect re-runs; bb reports that as "plugin voice-concierge crashed".
// So every effect in the frontend must have a block body or return a function literal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const EFFECTS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

/** Effects whose callback is an arrow with an expression body (other than a function), as "line: text". */
function expressionEffects(source: string): string[] {
  const file = ts.createSourceFile("app.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && EFFECTS.has(node.expression.text)) {
      const cb = node.arguments[0];
      if (cb !== undefined && ts.isArrowFunction(cb) && !ts.isBlock(cb.body) && !ts.isArrowFunction(cb.body) && !ts.isFunctionExpression(cb.body)) {
        found.push(`${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${node.getText().slice(0, 80)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

test("the check catches an expression-bodied effect", () => {
  assert.equal(expressionEffects("useEffect(() => ref.current?.scrollIntoView(), [x]);").length, 1);
  assert.equal(expressionEffects("useEffect(() => { ref.current?.scrollIntoView(); }, [x]);").length, 0);
  assert.equal(expressionEffects("useEffect(() => () => stop(), []);").length, 0);
});

test("no effect in app.tsx returns its expression's value", () => {
  const source = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
  assert.deepEqual(expressionEffects(source), []);
});
