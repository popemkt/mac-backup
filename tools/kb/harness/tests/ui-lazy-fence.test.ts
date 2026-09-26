import { describe, expect, test } from "bun:test";
import { UI_ENTRY, UI_LAZY_ONLY, uiZoneOf } from "../src/constraints.ts";
import {
  type UiImportSite,
  eagerClosure,
  lazyFenceBreaches,
  uiImportSites,
  uiSourceFiles,
} from "../src/ui-imports.ts";

/**
 * The UI's lazy-chunk fence (`UI_LAZY_ONLY` in constraints.ts): three reaches
 * the page only through a dynamic `import()`, so the always-loaded bundle —
 * every file the entry pulls in through eager imports — never carries it.
 *
 * It replaces three hand-kept boundary tests (the scene kit's, the lab's and
 * the graph's), each of which listed the files allowed to import three. The
 * list is the import graph's to answer: a file behind a lazy boundary may, a
 * file the entry loads eagerly may not, and a new study or renderer needs no
 * edit here.
 *
 * Red case: add `import { Color } from "three"` to `components/lab/routes.ts`
 * (always loaded, through the lab plugin), or turn `studies.ts`'s
 * `import("@/components/lab/embers/scene")` into a static import.
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
  test("no file the entry loads eagerly imports three", () => {
    const breaches = lazyFenceBreaches(uiImportSites());
    expect(
      breaches,
      `three reached without a lazy import() in between:\n${breaches.join("\n")}`,
    ).toEqual([]);
  });

  test("the fence has something to hold: three is imported, and only lazily reached", () => {
    const sites = uiImportSites();
    const importers = sites.filter((s) => s.kind === "eager" && UI_LAZY_ONLY.test(s.specifier));
    expect(importers.length).toBeGreaterThan(0);
    expect(uiSourceFiles()).toContain(UI_ENTRY);
    expect(eagerClosure(sites).size).toBeGreaterThan(10);
  });

  test("an eager chain to three is a breach; a lazy or type-only edge ends the chain", () => {
    const entry = "main.tsx";
    const breach = [
      site(entry, "@/lib/a", "eager", "lib/a.ts"),
      site("lib/a.ts", "three", "eager"),
    ];
    expect(lazyFenceBreaches(breach, entry)).toEqual(["main.tsx -> lib/a.ts -> three"]);

    const fenced = [
      site(entry, "@/lib/a", "lazy", "lib/a.ts"),
      site(entry, "@/lib/b", "type", "lib/b.ts"),
      site("lib/a.ts", "three", "eager"),
      site("lib/b.ts", "three/webgpu", "eager"),
    ];
    expect(lazyFenceBreaches(fenced, entry)).toEqual([]);
  });
});
