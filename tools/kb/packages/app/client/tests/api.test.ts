/**
 * The hand-written declarations in `src/api.d.ts` are what a consumer of the
 * bundle compiles against. This file fails `tsc`, not `bun test`, the moment
 * they and kb's node model stop describing the same node.
 */
import { expect, test } from "bun:test";
import type { KbNode as ModelNode, PropValue as ModelPropValue } from "@kb/model";
import type { KbNode, PropValue } from "../src/index.ts";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const nodeMatches: Same<KbNode, ModelNode> = true;
const propMatches: Same<PropValue, ModelPropValue> = true;

test("the published node shape is kb's node model", () => {
  expect([nodeMatches, propMatches]).toEqual([true, true]);
});
