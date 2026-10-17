/**
 * Which view owns which path, as the UI plugins a page loads by default
 * resolve it — the route table that used to be a closed union in
 * `lib/router`, now asserted over the contributions that replaced it — and
 * which families' browser entries the page loads for what the server reports.
 */
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeKernel, syncPlugins } from "@kb/plugin";
import { BUNDLED_FAMILIES, HOSTED_FAMILIES } from "@kb/bundled";
import { NO_SWITCHES, extensionRow, familyOn, type ExtensionRow } from "@kb/contracts";
import { agentExtension } from "@kb/agent";
import { LAB_SCENE_IDS, labExtension } from "@kb/lab";
import { LAB_STUDIES, LabStudyPoint } from "@kb/lab-ui";
import {
  findView,
  matchRoute,
  pageFootprint,
  ontologyPath,
  RoutePoint,
  SidebarSectionPoint,
} from "@kb/ui-sdk";
import { NoParams, viewKey, type OntologyView } from "@kb/views";
import { BROWSER_EXTENSIONS, CORE_UI_PLUGINS, familiesToLoad } from "@/ui-plugins";

/** The browser entries of the families on in a store with no switch written, as the resolver loads them. */
const ALWAYS_ON = await Promise.all(
  BUNDLED_FAMILIES.filter((declaration) => familyOn(declaration, NO_SWITCHES, () => {})).flatMap(
    (declaration) => BROWSER_EXTENSIONS[declaration.name]?.load() ?? [],
  ),
);

function kernelWithBuiltins() {
  const kernel = makeKernel();
  Effect.runSync(
    Effect.forEach([...CORE_UI_PLUGINS, ...ALWAYS_ON], (plugin) => kernel.load(plugin)),
  );
  return kernel;
}

function route(path: string): { surface: string; params: unknown } | null {
  const matched = matchRoute(kernelWithBuiltins().contributions(RoutePoint), path);
  return matched === null ? null : { surface: matched.view.id, params: matched.params };
}

describe("built-in routes", () => {
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
      "locations.section",
    ]);
  });

  it("each render a registered view that offers the page placement", () => {
    const kernel = kernelWithBuiltins();
    const paths = ["/", "/graph", "/o", "/o/abc/graph", "/canvas", "/canvas/abc"];
    for (const path of paths) {
      const matched = matchRoute(kernel.contributions(RoutePoint), path);
      expect(matched, path).not.toBeNull();
      expect(
        findView(kernel, matched?.view ?? viewKey("none.none", "None", NoParams))?.placements,
      ).toContain("page");
    }
  });

  it("disappear with the plugin that contributed them", () => {
    const kernel = kernelWithBuiltins();
    Effect.runSync(kernel.unload("canvas"));
    expect(matchRoute(kernel.contributions(RoutePoint), "/canvas/abc")).toBeNull();
    expect(kernel.contributions(SidebarSectionPoint).map((s) => s.id)).not.toContain(
      "canvas.section",
    );
  });
});

/** Every bundled family as a server reports it, each loaded or not as `loaded` says. */
function reported(loaded: (name: string) => boolean): ExtensionRow[] {
  return BUNDLED_FAMILIES.map((declaration) =>
    extensionRow(declaration, "bundled", loaded(declaration.name)),
  );
}

describe("the families the page loads", () => {
  const AGENT = extensionRow(agentExtension, "host", true);

  it("are each family the server reports loaded that the resolver has, in its order", () => {
    expect(familiesToLoad([...reported(() => true), AGENT])).toEqual([
      "outline",
      "collections",
      "graph",
      "canvas",
      "lab",
      "code",
      "chart",
      "locations",
      "backdrops",
      "agent",
    ]);
  });

  it("leave out a family the server reports not loaded: the lab while it is off", () => {
    expect(labExtension.optional).toEqual({ byDefault: "off" });
    expect(familiesToLoad(reported((name) => name !== "lab"))).toEqual([
      "outline",
      "collections",
      "graph",
      "canvas",
      "code",
      "chart",
      "locations",
      "backdrops",
    ]);
  });

  it("leave out a family the server does not report: the agent of a server that hosts none", () => {
    expect(familiesToLoad(reported(() => true))).not.toContain("agent");
    expect(familiesToLoad([...reported(() => true), { ...AGENT, enabled: false }])).not.toContain(
      "agent",
    );
  });

  it("leave out a family the page has no browser entry for", () => {
    const rows = [...reported(() => true), extensionRow({ name: "remote", label: "R" }, "x", true)];
    expect(familiesToLoad(rows)).toEqual([
      "outline",
      "collections",
      "graph",
      "canvas",
      "lab",
      "code",
      "chart",
      "locations",
      "backdrops",
    ]);
  });

  it("load each entry under the name it was resolved by", async () => {
    for (const [name, extension] of Object.entries(BROWSER_EXTENSIONS)) {
      if (extension !== null) expect((await extension.load()).name).toBe(name);
    }
  });
});

/** Every family kb declares: the registry's bundled ones, and those a host composes. */
// GAP [[01M53M9Y6BZFMT08EHNRNFG7Y9]] no one coverage property holds every family to all three hosts
const EVERY_FAMILY = [...BUNDLED_FAMILIES, ...HOSTED_FAMILIES];

describe("the resolver", () => {
  it("names every family, bundled or hosted: an entry, or null for one with no browser half", () => {
    const missing = EVERY_FAMILY.filter(({ name }) => !Object.hasOwn(BROWSER_EXTENSIONS, name));
    expect(missing.map(({ name }) => name)).toEqual([]);
  });

  it("has an entry for every family that provides a view, since the page draws its views", () => {
    const viewless = EVERY_FAMILY.filter(({ views }) => (views ?? []).length > 0).filter(
      ({ name }) => BROWSER_EXTENSIONS[name] === null,
    );
    expect(viewless.map(({ name }) => name)).toEqual([]);
  });

  it("declares exactly the server-only families as having no browser half", () => {
    const serverOnly = Object.entries(BROWSER_EXTENSIONS)
      .filter(([, extension]) => extension === null)
      .map(([name]) => name);
    expect(serverOnly.toSorted()).toEqual(["check", "docs"]);
  });

  it("names nothing beyond the families kb declares", () => {
    const known = new Set(EVERY_FAMILY.map(({ name }) => name));
    expect(Object.keys(BROWSER_EXTENSIONS).filter((name) => !known.has(name))).toEqual([]);
  });
});

describe("an optional family switched off on the server", () => {
  const SWITCHABLE = [...BUNDLED_FAMILIES, agentExtension].filter(
    ({ name, optional }) => optional !== undefined && BROWSER_EXTENSIONS[name] !== null,
  );

  it("is any family that can be switched and has a browser half", () => {
    expect(SWITCHABLE.map(({ name }) => name)).toEqual([
      "collections",
      "graph",
      "canvas",
      "lab",
      "code",
      "chart",
      "locations",
      "backdrops",
      "agent",
    ]);
  });

  for (const family of SWITCHABLE) {
    it(`${family.name}: the page drops its browser half and everything it contributed, and takes it back when switched on`, async () => {
      const kernel = makeKernel();
      for (const on of [true, false, true]) {
        const rows = [
          ...reported((name) => name !== family.name || on),
          extensionRow(agentExtension, "host", agentExtension.name !== family.name || on),
        ];
        const entries = await Promise.all(
          familiesToLoad(rows).flatMap((name) => BROWSER_EXTENSIONS[name]?.load() ?? []),
        );
        const failures = await Effect.runPromise(
          syncPlugins(kernel, [...CORE_UI_PLUGINS, ...entries]),
        );
        expect(failures).toEqual([]);
        expect({ on, holds: pageFootprint(family.name, kernel).length > 0 }).toEqual({
          on,
          holds: on,
        });
      }
      await Effect.runPromise(kernel.shutdown);
    });
  }

  it("the lab, on, shows every study while the graph is off but Sky, which reads the graph", async () => {
    const kernel = makeKernel();
    for (const graphOn of [false, true]) {
      const rows = reported((name) => name !== "graph" || graphOn);
      const entries = await Promise.all(
        familiesToLoad(rows).flatMap((name) => BROWSER_EXTENSIONS[name]?.load() ?? []),
      );
      const failures = await Effect.runPromise(
        syncPlugins(kernel, [...CORE_UI_PLUGINS, ...entries]),
      );
      expect(failures).toEqual([]);
      expect(pageFootprint("lab", kernel).length).toBeGreaterThan(0);
      const offered = kernel.contributions(LabStudyPoint).map(({ value }) => value.scene);
      const graphStudies = LAB_SCENE_IDS.filter((id) => LAB_STUDIES[id].readsGraph === true);
      expect(graphStudies).toEqual(["sky"]);
      expect(offered.toSorted()).toEqual(
        LAB_SCENE_IDS.filter((id) => graphOn || id !== "sky").toSorted(),
      );
    }
    await Effect.runPromise(kernel.shutdown);
  });
});

describe("a family's footprint on the page", () => {
  it("is what its browser entry, children included, holds in the page kernel, each row from the page", () => {
    const kernel = kernelWithBuiltins();
    for (const name of familiesToLoad(reported(() => true))) {
      const rows = pageFootprint(name, kernel);
      expect({ name, rows: rows.map(({ kind, id }) => [kind, id]) }).toEqual({
        name,
        rows: kernel.contributionsOf(name).map(({ point, id }) => [point, id]),
      });
      expect(rows.every((row) => row.family === name && row.source === "page" && row.enabled)).toBe(
        true,
      );
    }
    // The canvas's page half: its routes, its sidebar section and its views.
    const canvas = pageFootprint("canvas", kernel).map(({ kind, id }) => `${kind} ${id}`);
    expect(canvas).toContain("ui.routes canvas.page");
    expect(canvas).toContain("ui.sidebar canvas.section");
    Effect.runSync(kernel.unload("canvas"));
    expect(pageFootprint("canvas", kernel)).toEqual([]);
  });
});
