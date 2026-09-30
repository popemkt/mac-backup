/**
 * View nodes as data (DESIGN.md → Kinds, roles and options → View nodes): a
 * view is an option under `sys.views`, a node carrying `sys.f.view` is a view
 * node, and a host names its views in `sys.f.views`, the first its default.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode, type PropValue } from "../src/model.ts";
import { cardinalityOf, fieldTypeOf, targetQueryOf } from "../src/field-type.ts";
import { systemSeedNodes } from "../src/seed.ts";
import {
  VIEW_FAMILY_VALUES,
  VIEW_NODE_TARGET_QUERY,
  VIEW_OPTION_TARGET_QUERY,
  VIEW_VALUES,
  viewValueEntries,
  defaultViewIdOf,
  familyViewIdOf,
  hostViewIds,
  isViewNode,
  viewOptionId,
  viewOptionOf,
  viewsWithDefault,
} from "../src/view-node.ts";

const seed = new Map(systemSeedNodes().map((node) => [node.id, node]));
const ref = (v: string): PropValue => ({ t: "ref", v });
const carrying = (props: KbNode["props"]) => ({ props });

describe("view options", () => {
  test("every view kb provides is one option child of sys.views, carrying its family", () => {
    const options = seed.get(SYSTEM_IDS.viewsRoot)?.children ?? [];
    expect(options).toEqual(Object.keys(VIEW_VALUES).map(viewOptionId));
    for (const [viewId, value] of viewValueEntries()) {
      const family = seed.get(viewOptionId(viewId))?.props[SYSTEM_IDS.viewFamilyField];
      expect(family, viewId).toEqual(
        value.family === undefined ? undefined : [ref(VIEW_FAMILY_VALUES[value.family].id)],
      );
    }
  });

  test("sys.f.view is one ref into sys.views; sys.f.views many refs to view nodes", () => {
    const view = seed.get(SYSTEM_IDS.viewField);
    expect(fieldTypeOf(view?.props)).toBe("ref");
    expect(cardinalityOf(view?.props)).toBe("one");
    expect(targetQueryOf(view)).toBe(VIEW_OPTION_TARGET_QUERY);
    const views = seed.get(SYSTEM_IDS.viewsField);
    expect(fieldTypeOf(views?.props)).toBe("ref");
    expect(cardinalityOf(views?.props)).toBe("many");
    expect(targetQueryOf(views)).toBe(VIEW_NODE_TARGET_QUERY);
  });

  test("family is an option set: its field's own children; no placement is seeded yet", () => {
    expect(seed.has("sys.f.view.placement")).toBe(false);
    expect(seed.get(SYSTEM_IDS.viewFamilyField)?.children).toEqual(
      Object.values(VIEW_FAMILY_VALUES).map((family) => family.id),
    );
  });
});

describe("a view node and its host", () => {
  test("a node is a view node exactly when it carries a sys.f.view ref", () => {
    expect(isViewNode(carrying({}))).toBe(false);
    expect(isViewNode(carrying({ [SYSTEM_IDS.viewField]: [{ t: "str", v: "x" }] }))).toBe(false);
    const node = carrying({ [SYSTEM_IDS.viewField]: [ref("sys.view.outline.table")] });
    expect(isViewNode(node)).toBe(true);
    expect(viewOptionOf(node)).toBe("sys.view.outline.table");
  });

  test("a host's default view is the first it names; moving another first makes it the default", () => {
    const host = carrying({ [SYSTEM_IDS.viewsField]: [ref("v.1"), ref("v.2")] });
    expect(hostViewIds(host)).toEqual(["v.1", "v.2"]);
    expect(defaultViewIdOf(host)).toBe("v.1");
    expect(defaultViewIdOf(carrying({ [SYSTEM_IDS.viewsField]: [ref("v.2"), ref("v.1")] }))).toBe(
      "v.2",
    );
    expect(defaultViewIdOf(carrying({}))).toBeNull();
    expect(viewsWithDefault(host, "v.2")).toEqual(["v.2", "v.1"]);
    expect(viewsWithDefault(host, "v.new")).toEqual(["v.new", "v.1", "v.2"]);
  });

  test("a host's view of a family is the first it names whose option is of that family", () => {
    const views = new Map<string, { props: KbNode["props"] }>([
      ["v.snippet", carrying({ [SYSTEM_IDS.viewField]: [ref(viewOptionId("outline.snippet"))] })],
      ["v.table", carrying({ [SYSTEM_IDS.viewField]: [ref(viewOptionId("outline.table"))] })],
      ["v.board", carrying({ [SYSTEM_IDS.viewField]: [ref(viewOptionId("outline.board"))] })],
    ]);
    const lookup = (id: string) => views.get(id) ?? seed.get(id);
    const host = carrying({
      [SYSTEM_IDS.viewsField]: [ref("v.snippet"), ref("v.missing"), ref("v.table"), ref("v.board")],
    });
    expect(defaultViewIdOf(host)).toBe("v.snippet");
    expect(familyViewIdOf(host, "outline.frame", lookup)).toBe("v.table");
    expect(familyViewIdOf(host, "graph.renderer", lookup)).toBeNull();
    expect(familyViewIdOf(carrying({}), "outline.frame", lookup)).toBeNull();
  });
});
