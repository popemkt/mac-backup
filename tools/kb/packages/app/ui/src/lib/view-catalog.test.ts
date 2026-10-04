import { describe, expect, it } from "vitest";
import { ChartView } from "@kb/chart";
import { LabView } from "@kb/lab";
import { OutlineView, viewCatalogOf, type ViewCatalogEntry, type ViewKey } from "@kb/views";
import { pageCatalogOf } from "@/lib/view-catalog";

const held = [{ key: OutlineView }, { key: LabView }, { key: ChartView }];

/** What a server holding `keys` lists in `kb.manifest`. */
const served = (...keys: ViewKey<unknown>[]): ViewCatalogEntry[] => [
  ...viewCatalogOf(keys.map((key) => ({ key }))).entries(),
];

describe("the page's view catalog", () => {
  it("is the keys the page holds, restricted to the ids the server lists", () => {
    const catalog = pageCatalogOf(held, served(OutlineView, ChartView), () => {});
    expect(catalog.items.map((view) => view.key)).toEqual([OutlineView, ChartView]);
    expect(catalog.keyOf(LabView.option)).toBeNull();
    expect(catalog.keyOf(ChartView.option)).toBe(ChartView);
  });

  it("reports a key the page holds that the server does not list, and never lists it", () => {
    const reported: string[] = [];
    const catalog = pageCatalogOf(held, served(OutlineView), (id) => reported.push(id));
    expect(reported).toEqual([LabView.id, ChartView.id]);
    expect(catalog.listedOf(LabView.option)).toBeNull();
  });

  it("lists a view the server names that the page holds no key for by the server's entry", () => {
    const remote = {
      id: "remote.only",
      option: "sys.view.remote.only",
      label: "Remote",
      settings: {},
    };
    const catalog = pageCatalogOf(
      [{ key: OutlineView }],
      [...served(OutlineView), remote],
      () => {},
    );
    expect(catalog.keyOf("remote.only")).toBeNull();
    expect(catalog.entries().map((entry) => entry.id)).toEqual([OutlineView.id]);
    expect(catalog.listedOf(remote.option)).toEqual(remote);
  });

  it("is the page's own keys while no server has answered", () => {
    const catalog = pageCatalogOf(held, null, () => {
      throw new Error("nothing is reported without a server");
    });
    expect(catalog.items).toEqual(held);
  });
});
