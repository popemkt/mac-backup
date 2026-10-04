import { describe, expect, test } from "bun:test";
import {
  UI_ALLOWS,
  UI_SPECIFIER_ALLOWS,
  UI_SRC,
  type UiZone,
  isUiTestFile,
  uiZoneOf,
} from "../src/constraints.ts";
import {
  uiImportSites,
  uiImportSitesIn,
  uiRepoPath,
  uiSourceFiles,
  uiViolation,
  uiViolations,
} from "../src/ui-imports.ts";

/**
 * The zones that leave `@kb/ui` as extension UI halves, fenced to themselves
 * and `@kb/ui-sdk` (DESIGN-UI.md → Extension UI halves). Each is a red
 * fixture: a file there reaching a store, a shell `lib` module or an action
 * breaks the matrix, and the same file reaching the sdk package does not.
 */
const EXTENSION_ZONES = [
  "components/agent",
  "components/canvas",
  "components/chart",
  "components/code",
  "components/lab",
] as const satisfies readonly UiZone[];

/**
 * How each import of `source`, written in a file of `zone`, breaks the matrix.
 * The file is a real one of that zone, because a zone is not always a folder
 * (the canvas's 3D projection is a set of files).
 */
function fixtureBreaches(zone: UiZone, source: string): Array<string | undefined> {
  const file = uiSourceFiles().find(
    (candidate) => uiZoneOf(candidate) === zone && !isUiTestFile(candidate),
  );
  if (file === undefined) throw new Error(`no file in ${zone}`);
  return uiImportSitesIn(file, source).map((site) => uiViolation(site));
}

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

  test("an extension zone reaches the shell only through the sdk", () => {
    for (const zone of EXTENSION_ZONES) {
      expect(
        fixtureBreaches(zone, 'import { useOutlineStore } from "@/stores/outline.store";\n'),
      ).toEqual([`${zone} -> stores`]);
      expect(fixtureBreaches(zone, 'import { mutations } from "@/actions/mutations";\n')).toEqual([
        `${zone} -> actions`,
      ]);
      expect(fixtureBreaches(zone, 'import { loadManifest } from "@/lib/manifest";\n')).toEqual([
        `${zone} -> lib`,
      ]);
      expect(fixtureBreaches(zone, 'import { cn, browserHost } from "@kb/ui-sdk";\n')).toEqual([
        undefined,
      ]);
    }
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
