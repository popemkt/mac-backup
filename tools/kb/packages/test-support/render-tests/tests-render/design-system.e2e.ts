// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The design-system switch in a real engine. What each stylesheet sets is held
// to its contract by `ui/src/lib/design-systems.test.ts`, which reads the CSS
// as data; what only a browser can show is that choosing a system in the
// preferences paints the whole page with it. So for every system the picker
// offers, in light and in dark, the root's computed `--background` and
// `--primary` must equal the ones the system's own live swatch resolves —
// the swatch carries `data-theme`, so the cascade that paints it is that
// system's sheet — and no two systems may paint the root alike.
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

const TOKENS = ["--background", "--primary"] as const;

async function openPreferences(page: Page) {
  const picker = page.getByRole("radiogroup", { name: "design system", exact: true });
  if (!(await picker.isVisible())) {
    await page.getByRole("button", { name: "Preferences", exact: true }).click();
  }
  await expect(picker).toBeVisible();
  return picker;
}

/** The tokens as the root computes them, and as system `id`'s swatch computes them. */
async function paint(page: Page, id: string) {
  return page.evaluate(
    ({ system, tokens }) => {
      const read = (el: Element) =>
        tokens.map((token) => getComputedStyle(el).getPropertyValue(token).trim());
      const swatch = document.querySelector(`[data-testid="design-system-${system}"] [data-theme]`);
      if (swatch === null) throw new Error(`no swatch for ${system}`);
      return {
        theme: document.documentElement.getAttribute("data-theme"),
        root: read(document.documentElement),
        swatch: read(swatch),
      };
    },
    { system: id, tokens: [...TOKENS] },
  );
}

for (const scheme of ["light", "dark"] as const) {
  test(`every design system paints the page it is chosen for (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    const picker = await openPreferences(page);
    const radios = picker.getByRole("radio");
    const ids = await radios.evaluateAll((els) =>
      els.map((el) => (el.getAttribute("data-testid") ?? "").replace(/^design-system-/, "")),
    );
    expect(ids.length).toBeGreaterThan(1);

    const painted = new Map<string, string>();
    for (const id of ids) {
      await (await openPreferences(page)).getByTestId(`design-system-${id}`).click();
      await expect(page.getByTestId(`design-system-${id}`)).toHaveAttribute("aria-checked", "true");
      await expect.poll(() => paint(page, id).then((p) => p.theme)).toBe(id);
      const now = await paint(page, id);
      expect(
        now.root.every((value) => value !== ""),
        `${id}: tokens resolve`,
      ).toBe(true);
      expect(now.root, `${id}: the root is painted by ${id}'s sheet`).toEqual(now.swatch);
      painted.set(id, now.root.join(" | "));
    }
    // A switch that changed nothing would pass the check above for every id.
    expect(new Set(painted.values()).size, JSON.stringify([...painted])).toBe(ids.length);

    // The choice is a device preference: it survives a reload.
    const last = ids.at(-1) ?? "";
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBe(last);
  });
}
