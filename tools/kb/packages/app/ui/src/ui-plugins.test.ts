/**
 * Which surface owns which path, as the built-in UI plugins resolve it — the
 * route table that used to be a closed union in `lib/router`, now asserted
 * over the contributions that replaced it.
 */
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { definePlugin, makeKernel } from "@kb/plugin";
import { GearIcon } from "@phosphor-icons/react";
import { SidebarSectionPoint, SurfacePoint, matchSurface } from "@/lib/plugins";
import { ontologyPath, type OntologyView } from "@/lib/router";
import { BUILTIN_UI_PLUGINS, OPTIONAL_UI_PLUGINS, uiPluginsFor } from "@/ui-plugins";

function kernelWithBuiltins() {
  const kernel = makeKernel();
  Effect.runSync(Effect.forEach(BUILTIN_UI_PLUGINS, (plugin) => kernel.load(plugin)));
  return kernel;
}

function route(path: string): { surface: string; params: Record<string, string> } | null {
  const matched = matchSurface(kernelWithBuiltins().contributions(SurfacePoint), path);
  return matched === null ? null : { surface: matched.surface.id, params: { ...matched.params } };
}

describe("built-in surfaces", () => {
  it("match the canvas, graph and outline paths", () => {
    expect(route("/canvas")).toEqual({ surface: "canvas.list", params: {} });
    expect(route("/canvas/abc")).toEqual({ surface: "canvas.page", params: { id: "abc" } });
    expect(route("/graph")).toEqual({ surface: "graph.page", params: {} });
    expect(route("/graph/p%201")).toEqual({
      surface: "graph.page",
      params: { perspective: "p 1" },
    });
    expect(route("/")).toEqual({ surface: "outline.main", params: {} });
  });

  it("match the ontology list, page, outline and graph views", () => {
    expect(route("/o")?.surface).toBe("ontology.list");
    expect(route("/o/")?.surface).toBe("ontology.list");
    expect(route("/o/abc")).toEqual({
      surface: "ontology.scope",
      params: { id: "abc", view: "page" },
    });
    expect(route("/o/abc/")?.params).toEqual({ id: "abc", view: "page" });
    expect(route("/o/abc/outline")?.params).toEqual({ id: "abc", view: "outline" });
    expect(route("/o/abc/graph")?.params).toEqual({ id: "abc", view: "graph" });
    expect(route("/o/a%2Fb")?.params).toEqual({ id: "a/b", view: "page" });
  });

  it("leave unknown sub-views and deeper paths unowned, which is not found", () => {
    expect(route("/")?.surface).toBe("outline.main");
    expect(route("/o/abc/schema")).toBeNull();
    expect(route("/o/abc/graph/extra")).toBeNull();
    expect(route("/other")).toBeNull();
  });

  it("round-trip an ontology through ontologyPath", () => {
    for (const view of ["page", "outline", "graph"] satisfies OntologyView[]) {
      expect(route(ontologyPath("a b", view))?.params).toEqual({ id: "a b", view });
    }
  });

  it("each lead to themselves from one sidebar section, in order", () => {
    const sections = kernelWithBuiltins()
      .contributions(SidebarSectionPoint)
      .toSorted((a, b) => a.value.order - b.value.order)
      .map((section) => section.id);
    expect(sections).toEqual([
      "outline.home",
      "graph.section",
      "ontology.section",
      "canvas.section",
      "outline.pinned",
    ]);
  });

  it("disappear with the plugin that contributed them", () => {
    const kernel = kernelWithBuiltins();
    Effect.runSync(kernel.unload("canvas"));
    expect(matchSurface(kernel.contributions(SurfacePoint), "/canvas/abc")).toBeNull();
    expect(kernel.contributions(SidebarSectionPoint).map((s) => s.id)).not.toContain(
      "canvas.section",
    );
  });
});

describe("optional plugins", () => {
  const extra = definePlugin({ name: "extra", apply: () => Effect.void });
  const optional = [{ plugin: extra, label: "extra", icon: GearIcon }];
  const names = (enabled: string[]) => uiPluginsFor(optional, enabled).map((p) => p.name);

  it("are left out until the preference names them", () => {
    const builtins = BUILTIN_UI_PLUGINS.map((p) => p.name);
    expect(names([])).toEqual(builtins);
    expect(names(["unknown"])).toEqual(builtins);
    expect(names(["extra"])).toEqual([...builtins, "extra"]);
  });

  it("never drop a built-in, whatever the preference says", () => {
    expect(names(["outline"])).toEqual(BUILTIN_UI_PLUGINS.map((p) => p.name));
  });
});

describe("the lab", () => {
  it("ships as an optional plugin, never as a built-in", () => {
    expect(OPTIONAL_UI_PLUGINS.map((entry) => entry.plugin.name)).toContain("lab");
    expect(BUILTIN_UI_PLUGINS.map((plugin) => plugin.name)).not.toContain("lab");
    expect(uiPluginsFor(OPTIONAL_UI_PLUGINS, []).map((p) => p.name)).not.toContain("lab");
    expect(uiPluginsFor(OPTIONAL_UI_PLUGINS, ["lab"]).map((p) => p.name)).toContain("lab");
  });
});
