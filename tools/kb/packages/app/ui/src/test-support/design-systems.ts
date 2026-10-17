/**
 * The design systems the page contributes, for the checks that run over
 * every one of them (the design-system point's contract, contrast, the lab's
 * bloom bound): core's, and those of each family on in a store with no
 * switch written, loaded as the page loads them (`ui-plugins.ts`) into a
 * kernel of their own, so reading them moves nothing on the page. Each is
 * read with its sheet as its contribution carries it, against layer 1
 * (`design-system.css`), so a system a family adds is checked with no list
 * to update.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import { NO_SWITCHES, familyOn } from "@kb/contracts";
import { makeKernel, syncPlugins, type Plugin } from "@kb/plugin";
import { DesignSystemPoint, type DesignSystem } from "@kb/ui-sdk";
import { designSystemsUiPlugin } from "@/design-systems";
import { readDesignSystemSheets, type DesignSystemSheets } from "@/lib/design-system-sheets";
import { BROWSER_EXTENSIONS } from "@/ui-plugins";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Layer 1: what every design system is read against. */
const LAYER1_CSS = readFileSync(path.join(SRC, "design-system.css"), "utf8");

/** The browser entries of the families on in a store with no switch written, as the page loads them. */
export const PAGE_FAMILIES: readonly Plugin[] = await Promise.all(
  BUNDLED_FAMILIES.filter((declaration) => familyOn(declaration, NO_SWITCHES, () => {})).flatMap(
    (declaration) => BROWSER_EXTENSIONS[declaration.name]?.load() ?? [],
  ),
);

/** The design systems `plugins` contribute, in contribution order, read from a kernel of their own. */
function designSystemsOf(plugins: readonly Plugin[]): readonly DesignSystem[] {
  const kernel = makeKernel();
  Effect.runSync(syncPlugins(kernel, plugins));
  return kernel.contributions(DesignSystemPoint).map(({ value }) => value);
}

/** The page's design systems: core's first, then each family's. */
export const PAGE_DESIGN_SYSTEMS: readonly DesignSystem[] = designSystemsOf([
  designSystemsUiPlugin,
  ...PAGE_FAMILIES,
]);

/** `systems` read against layer 1. */
export function sheetsOf(systems: readonly DesignSystem[]): DesignSystemSheets {
  return readDesignSystemSheets(
    LAYER1_CSS,
    systems.map(({ key, stylesheet }) => ({ id: key.id, stylesheet })),
  );
}

/** The page's design systems' sheets. */
export const PAGE_SHEETS: DesignSystemSheets = sheetsOf(PAGE_DESIGN_SYSTEMS);
