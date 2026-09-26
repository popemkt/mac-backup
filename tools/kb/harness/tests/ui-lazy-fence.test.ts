import { describe, expect, test } from "bun:test";
import { UI_ENTRY, UI_LAZY_DEPTH, UI_LAZY_ONLY, uiZoneOf } from "../src/constraints.ts";
import { importsOf } from "../src/import-graph.ts";
import {
  type UiImportSite,
  lazyDepths,
  lazyFenceBreaches,
  uiImportSites,
  uiSourceFiles,
} from "../src/ui-imports.ts";

/**
 * The UI's lazy-chunk fence (`UI_LAZY_ONLY` and `UI_LAZY_DEPTH` in
 * constraints.ts): three loads only in a chunk of its own, so every path from
 * the entry to a three import crosses two dynamic `import()`s — the surface's
 * route chunk, then the 3D view's own.
 *
 * It replaces three hand-kept boundary tests (the scene kit's, the lab's and
 * the graph's), each of which listed the files allowed to import three. The
 * list is the import graph's to answer, and a new study or renderer needs no
 * edit here.
 *
 * Red cases: add `import { Color } from "three"` to `components/lab/routes.ts`
 * (always loaded, through the lab plugin) or to `components/graph/graph-page.tsx`
 * (the graph's route chunk); turn `studies.ts`'s
 * `import("@/components/lab/embers/scene")` or graph-adapters' lazy 3D host
 * into a static import.
 */

function site(file: string, specifier: string, kind: UiImportSite["kind"], target?: string) {
  return {
    file,
    zone: uiZoneOf(file),
    specifier,
    kind,
    line: 1,
    target,
    targetZone: target === undefined ? undefined : uiZoneOf(target),
    gap: undefined,
  } satisfies UiImportSite;
}

describe("ui-lazy-fence", () => {
  test("every path from the entry to a three import crosses two dynamic imports", () => {
    const breaches = lazyFenceBreaches(uiImportSites());
    expect(
      breaches,
      `three reached outside a chunk of its own (=> is a lazy edge):\n${breaches.join("\n")}`,
    ).toEqual([]);
  });

  test("the fence has something to hold: three is imported, and reached at depth", () => {
    const sites = uiImportSites();
    const importers = sites.filter((s) => s.kind === "eager" && UI_LAZY_ONLY.test(s.specifier));
    expect(importers.length).toBeGreaterThan(0);
    expect(uiSourceFiles()).toContain(UI_ENTRY);
    const depths = lazyDepths(sites);
    expect([...depths.values()].filter((d) => d.depth === 0).length).toBeGreaterThan(10);
    const reached = importers.filter((s) => (depths.get(s.file)?.depth ?? -1) >= UI_LAZY_DEPTH);
    expect(reached.length, "some three import is reached through the fence").toBeGreaterThan(0);
  });

  test("three in the entry's chunk or a route's chunk is a breach; in its own chunk it is not", () => {
    const entry = "main.tsx";
    const inEntry = [
      site(entry, "@/lib/a", "eager", "lib/a.ts"),
      site("lib/a.ts", "three", "eager"),
    ];
    expect(lazyFenceBreaches(inEntry, entry)).toEqual(["main.tsx -> lib/a.ts -> three"]);

    // The graph page is a route chunk: lazily loaded, but on every visit.
    const graphPage = "components/graph/graph-page.tsx";
    const inRoute = [
      site(entry, "@/components/graph/graph-page", "lazy", graphPage),
      site(graphPage, "three", "eager"),
    ];
    expect(lazyFenceBreaches(inRoute, entry)).toEqual([`main.tsx => ${graphPage} -> three`]);

    // One eager path is enough: the shortest path decides, not the one drawn.
    const host = "components/graph/force3d-graph.tsx";
    const bypassed = [
      site(entry, "@/components/graph/graph-page", "lazy", graphPage),
      site(graphPage, "./force3d-graph", "lazy", host),
      site(graphPage, "./force3d-graph", "eager", host),
      site(host, "three/webgpu", "eager"),
    ];
    expect(lazyFenceBreaches(bypassed, entry)).toEqual([
      `main.tsx => ${graphPage} -> ${host} -> three/webgpu`,
    ]);

    // A lazy import("three") is one crossing: from the entry chunk it is
    // still in reach of every visit; from a route chunk it is its own chunk.
    const lazyInEntry = [
      site(entry, "@/lib/a", "eager", "lib/a.ts"),
      site("lib/a.ts", "three", "lazy"),
    ];
    expect(lazyFenceBreaches(lazyInEntry, entry)).toEqual(["main.tsx -> lib/a.ts => three"]);
    const lazyInRoute = [
      site(entry, "@/components/graph/graph-page", "lazy", graphPage),
      site(graphPage, "three", "lazy"),
    ];
    expect(lazyFenceBreaches(lazyInRoute, entry)).toEqual([]);

    const fenced = [
      site(entry, "@/components/graph/graph-page", "lazy", graphPage),
      site(graphPage, "./force3d-graph", "lazy", host),
      site(graphPage, "@/lib/b", "type", "lib/b.ts"),
      site(host, "three/webgpu", "eager"),
      site("lib/b.ts", "three", "eager"),
    ];
    expect(lazyFenceBreaches(fenced, entry)).toEqual([]);
  });

  test("require() and import = require() are eager imports the fence sees, in source order", () => {
    // The order is what ui-imports pairs with source lines: a require read
    // off the program sits where it is written, not after the module record.
    const source = [
      'const three = require("three");',
      'import type { Color } from "three";',
      "const tagged = require(`three/webgpu`);",
      'import webgpu = require("three/webgpu");',
      'import type Types = require("three/addons");',
      'const later = import("three/examples");',
      "const tick = import(`three/tsl`);",
      "const dynamic = require(`three/${name}`);",
      "const dynamicLazy = import(`three/${name}`);",
    ].join("\n");
    expect(importsOf("probe.ts", source)).toEqual([
      { specifier: "three", kind: "eager" },
      { specifier: "three", kind: "type" },
      { specifier: "three/webgpu", kind: "eager" },
      { specifier: "three/webgpu", kind: "eager" },
      { specifier: "three/addons", kind: "type" },
      { specifier: "three/examples", kind: "lazy" },
      { specifier: "three/tsl", kind: "lazy" },
    ]);
  });
});
