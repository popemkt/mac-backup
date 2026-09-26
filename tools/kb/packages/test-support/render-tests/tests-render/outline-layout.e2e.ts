// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Layout the unit suite cannot see: whether something painted outside its box
// makes the page scroll sideways, and whether an absolutely placed badge is
// clipped. Only a real engine measuring real boxes can answer either.
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

async function home(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-bullet-count]").first()).toBeVisible();
}

/** The main region's own sideways overflow, and each count badge's box against it. */
function measure(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("[data-main-region]");
    if (!(main instanceof HTMLElement)) return null;
    const frame = main.getBoundingClientRect();
    const badges = [...document.querySelectorAll("[data-bullet-count]")].map((el) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, right: box.right, text: el.textContent };
    });
    return {
      overflow: main.scrollWidth - main.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      frameLeft: frame.left,
      badges,
    };
  });
}

type Measure = NonNullable<Awaited<ReturnType<typeof measure>>>;

/**
 * The layout once it has stopped moving: two measurements in a row that
 * agree, with at least one count badge laid out. Rows mount and fonts swap
 * after the first badge is visible, so the first sample that happens to pass
 * can still be a frame in motion; the assertions run once, on this one.
 */
async function settled(page: Page): Promise<Measure> {
  const last: { m: Measure | null; key: string } = { m: null, key: "" };
  await expect
    .poll(
      async () => {
        const m = await measure(page);
        const key = JSON.stringify(m);
        const still = m !== null && m.badges.length > 0 && key === last.key;
        last.m = m;
        last.key = key;
        return still;
      },
      { intervals: [100, 250] },
    )
    .toBe(true);
  if (last.m === null) throw new Error("no main region");
  return last.m;
}

for (const width of [1280, 390]) {
  test(`home at ${width}px never scrolls sideways, and its header wash stays inside`, async ({
    page,
  }) => {
    await home(page, width);
    await expect(page.locator("[data-header-wash]")).toHaveCount(1);
    const m = await settled(page);
    expect(m.overflow).toBe(0);
    expect(m.pageOverflow).toBe(0);
  });

  test(`home at ${width}px shows every child count whole`, async ({ page }) => {
    await home(page, width);
    const m = await settled(page);
    for (const badge of m.badges) {
      expect(badge.left, `count ${badge.text}`).toBeGreaterThanOrEqual(m.frameLeft);
    }
  });
}
