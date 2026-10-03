/**
 * A docs view's name is what `render.view`, `docs.check` and
 * `ui://kb/view/<name>` address it by, so the one write check refuses a docs
 * view named by no workspace name, or by a name another docs view goes by —
 * and, like the value check, only for a node the write makes a docs view or
 * renames, so a store holding a bad name stays editable.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, docsViewProps, txIntegrityError, type KbNode } from "../src/index.ts";
import { bundledSeed } from "@kb/bundled";

const AT = "2026-01-01T00:00:00.000Z";
const SEED = bundledSeed(AT);

function docsView(id: string, text: string): KbNode {
  return {
    id,
    text,
    props: docsViewProps({ output: `docs/${id}.md`, query: "[:find ?id]", template: "todos" }),
    children: [],
    createdAt: AT,
    updatedAt: AT,
  };
}

const write = (before: KbNode[], ...upserts: KbNode[]) =>
  txIntegrityError(before, { upserts, deletes: [] });

describe("a docs view's name", () => {
  test("is a workspace name", () => {
    expect(write(SEED, docsView("docs.a", "todos"))).toBeNull();
    expect(write(SEED, docsView("docs.b", "has space"))).toContain("is not a workspace name");
    expect(write(SEED, docsView("docs.c", "../escape"))).toContain("is not a workspace name");
  });

  test("is one no other docs view goes by, when made or renamed", () => {
    const stored = [...SEED, docsView("docs.a", "todos"), docsView("docs.b", "rules")];
    expect(write(stored, docsView("docs.c", "todos"))).toContain("taken by docs.a");
    expect(write(stored, docsView("docs.b", " todos "))).toContain("taken by docs.a");
    expect(write(stored, docsView("docs.b", "rules2"))).toBeNull();
  });

  test("binds only docs views, and a stored bad name stays editable", () => {
    expect(write(SEED, { ...docsView("n.1", "has space"), props: {} })).toBeNull();
    const clash = [...SEED, docsView("docs.a", "todos"), docsView("docs.b", "todos")];
    const edited = docsView("docs.b", "todos");
    expect(
      write(clash, {
        ...edited,
        props: { ...edited.props, [SYSTEM_IDS.viewOutputField]: [{ t: "str", v: "docs/b2.md" }] },
      }),
    ).toBeNull();
  });
});
