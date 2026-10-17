/** The scaffolding the graph elides: system nodes, commands, and the schema (tags and fields). */
import { describe, expect, test } from "bun:test";
import { isScaffolding } from "../src/index.ts";
import { node } from "./fixtures.ts";

const typed = (id: string, type: string) =>
  node({ id, text: id, props: { "sys.f.type": [{ t: "ref", v: type }] } });

describe("isScaffolding", () => {
  test("a sys.* node, a command, a tag and a field are scaffolding", () => {
    expect(isScaffolding(node({ id: "sys.views", text: "Views" }))).toBe(true);
    expect(isScaffolding(typed("c", "sys.command"))).toBe(true);
    expect(isScaffolding(typed("t", "sys.tag"))).toBe(true);
    expect(isScaffolding(typed("f", "sys.field"))).toBe(true);
  });

  test("content is not, whatever it is tagged", () => {
    expect(isScaffolding(typed("a", "t.todo"))).toBe(false);
    expect(isScaffolding(node({ id: "b", text: "B" }))).toBe(false);
  });
});
