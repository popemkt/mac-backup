import { describe, expect, it } from "vitest";
import { ChartView } from "@kb/chart";
import { LabView, OutlineView } from "@kb/views";
import { pageCatalogOf } from "@/lib/view-catalog";

const held = [{ key: OutlineView }, { key: LabView }, { key: ChartView }];

describe("the page's view catalog", () => {
  it("is the keys the page holds, restricted to the ids the server lists", () => {
    const catalog = pageCatalogOf(held, new Set([OutlineView.id, ChartView.id]), () => {});
    expect(catalog.items.map((view) => view.key)).toEqual([OutlineView, ChartView]);
    expect(catalog.keyOf(LabView.option)).toBeNull();
    expect(catalog.keyOf(ChartView.option)).toBe(ChartView);
  });

  it("reports a key the page holds that the server does not list, and never lists it", () => {
    const reported: string[] = [];
    pageCatalogOf(held, new Set([OutlineView.id]), (id) => reported.push(id));
    expect(reported).toEqual([LabView.id, ChartView.id]);
  });

  it("lists a view the server names only when the page holds its key", () => {
    const catalog = pageCatalogOf(held, new Set([OutlineView.id, "remote.only"]), () => {});
    expect(catalog.keyOf("remote.only")).toBeNull();
    expect(catalog.entries().map((entry) => entry.id)).toEqual([OutlineView.id]);
  });

  it("is the page's own keys while no server has answered", () => {
    const catalog = pageCatalogOf(held, null, () => {
      throw new Error("nothing is reported without a server");
    });
    expect(catalog.items).toEqual(held);
  });
});
