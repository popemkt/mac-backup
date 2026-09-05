import { describe, expect, test } from "bun:test";
import {
  UI_ALLOWS,
  UI_SPECIFIER_ALLOWS,
  UI_SRC,
  type UiZone,
  uiZoneOf,
} from "../src/constraints.ts";
import { uiImportSites, uiRepoPath, uiSourceFiles, uiViolations } from "../src/ui-imports.ts";

/**
 * The UI's intra-package import matrix (wave u1 / plan D5).
 *
 * `ARCHITECTURE.md` stated who may import whom inside `packages/app/ui` as a
 * markdown table, and nothing read it. The table now lives in
 * `constraints.ts` as {@link UI_ALLOWS}; this is the check that applies it.
 *
 * Three axes:
 *   1. every intra-package import lands in a zone its importer may reach, or
 *      carries a `GAP [[id]]` on its line;
 *   2. no `GAP [[id]]` sits on an import that is not a breach — a sanction
 *      outliving its breach reads as covered and is not;
 *   3. `UI_ALLOWS` names exactly the zones the tree has.
 *
 * That a marker's id resolves to a real `#gap` node is `gap-markers-resolve`'s
 * assertion, not this file's: it already scans every `.ts`/`.tsx` in the
 * workspace, these files included, and a second resolver here would be a
 * second mechanism for one rule.
 *
 * Red case: drop `// GAP [[…]]` from `lib/toast.ts:1`, or add
 * `import { useOutlineStore } from "@/stores/outline.store"` to
 * `components/outline/tag-chip.tsx`.
 */
describe("ui-boundaries", () => {
  test("every import inside the UI lands in a zone its importer may reach", () => {
    const unsanctioned = uiViolations()
      .filter((site) => site.gap === undefined)
      .map((site) => `${uiRepoPath(site.file)}:${site.line}: ${site.violation}`)
      .toSorted();
    expect(
      unsanctioned,
      `Unsanctioned UI import-matrix breaches (add the edge to UI_ALLOWS, or file a #gap and mark the line):\n${unsanctioned.join("\n")}`,
    ).toEqual([]);
  });

  test("no GAP marker sanctions an import that the matrix already allows", () => {
    const breaches = new Set(uiViolations().map((site) => `${site.file}:${site.line}`));
    const stale = uiImportSites()
      .filter((site) => site.gap !== undefined && !breaches.has(`${site.file}:${site.line}`))
      .map(
        (site) => `${uiRepoPath(site.file)}:${site.line}: GAP [[${site.gap}]] on an allowed import`,
      )
      .toSorted();
    expect(stale, `Stale UI import gap markers:\n${stale.join("\n")}`).toEqual([]);
  });

  test("UI_ALLOWS names exactly the zones present under the UI's src/", () => {
    const present = new Set<UiZone>(uiSourceFiles().map((file) => uiZoneOf(file)));
    const rows = Object.keys(UI_ALLOWS) as UiZone[];
    expect(rows.toSorted(), `${UI_SRC} zones and UI_ALLOWS rows must match`).toEqual(
      [...present].toSorted(),
    );
  });

  test("every zone a row or the specifier rule names is itself a row", () => {
    const rows = new Set(Object.keys(UI_ALLOWS));
    const unknown = [
      ...Object.entries(UI_ALLOWS).flatMap(([zone, allowed]) =>
        allowed.filter((target) => !rows.has(target)).map((target) => `${zone} -> ${target}`),
      ),
      ...Object.entries(UI_SPECIFIER_ALLOWS).flatMap(([specifier, zones]) =>
        zones.filter((zone) => !rows.has(zone)).map((zone) => `${specifier} <- ${zone}`),
      ),
    ].toSorted();
    expect(unknown, `UI_ALLOWS entries naming a zone with no row:\n${unknown.join("\n")}`).toEqual(
      [],
    );
  });
});
