// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The design-system switch in a real engine. What each contributed system's
// sheet sets is held to its contract by
// `ui/src/design-system-point.contract.test.tsx`, which reads the CSS as data;
// what only a browser can show is that choosing a system in the
// preferences paints the whole page with it. Preferences draws core's
// design-system field with the page's field editor, and its picker leads
// each option with that system's live swatch (`data-option-preview`, which
// carries `data-theme`, so the cascade that paints it is that system's
// sheet). So for every system the picker offers, in light and in dark, the
// root's computed `--background` and `--primary` must equal the ones the
// chosen value's own swatch resolves, and no two systems may paint the root
// alike.
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const TOKENS = ["--background", "--primary"] as const;

/** Preferences' design-system setting, the popover opened when it is not. */
async function designSetting(page: Page) {
  const setting = page.locator('section[aria-label="design"]');
  if (!(await setting.isVisible())) {
    await page.getByRole("button", { name: "Preferences", exact: true }).click();
  }
  await expect(setting).toBeVisible();
  return setting;
}

/**
 * The field's picker, opened by a click on its value beside the chip (the
 * chip itself follows to the option's page): its rows.
 */
async function openPicker(page: Page) {
  const setting = await designSetting(page);
  await setting
    .locator("[data-value-slot]")
    .first()
    .click({ position: { x: 2, y: 2 } });
  const rows = page.locator('[role="option"]:has([data-option-preview])');
  await expect(rows.first()).toBeVisible();
  return rows;
}

/** The tokens as the root computes them, and as the chosen value's swatch computes them. */
async function paint(page: Page) {
  return page.evaluate(
    ({ tokens }) => {
      const read = (el: Element) =>
        tokens.map((token) => getComputedStyle(el).getPropertyValue(token).trim());
      const swatch = document.querySelector('section[aria-label="design"] [data-option-preview]');
      if (swatch === null) throw new Error("the chosen system shows no swatch");
      return {
        theme: document.documentElement.getAttribute("data-theme"),
        swatchOf: swatch.getAttribute("data-option-preview"),
        root: read(document.documentElement),
        swatch: read(swatch),
      };
    },
    { tokens: [...TOKENS] },
  );
}

for (const scheme of ["light", "dark"] as const) {
  test(`every design system paints the page it is chosen for (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    const ids = await (
      await openPicker(page)
    ).evaluateAll((rows) =>
      rows.map(
        (row) =>
          row.querySelector("[data-option-preview]")?.getAttribute("data-option-preview") ?? "",
      ),
    );
    await page.keyboard.press("Escape");
    expect(ids.length).toBeGreaterThan(1);

    const painted = new Map<string, string>();
    for (const id of ids) {
      await (
        await openPicker(page)
      )
        .filter({ has: page.locator(`[data-option-preview="${id}"]`) })
        .click();
      await expect.poll(() => paint(page).then((p) => [p.theme, p.swatchOf])).toEqual([id, id]);
      const now = await paint(page);
      expect(
        now.root.every((value) => value !== ""),
        `${id}: tokens resolve`,
      ).toBe(true);
      expect(now.root, `${id}: the root is painted by ${id}'s sheet`).toEqual(now.swatch);
      painted.set(id, now.root.join(" | "));
    }
    // A switch that changed nothing would pass the check above for every id.
    expect(new Set(painted.values()).size, JSON.stringify([...painted])).toBe(ids.length);

    // The choice is core's setting, and the painter's record paints it again
    // before the graph loads: it survives a reload.
    const last = ids.at(-1) ?? "";
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBe(last);
  });
}
