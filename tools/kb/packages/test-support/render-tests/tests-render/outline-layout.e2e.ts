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

for (const width of [1280, 390]) {
  test(`home at ${width}px never scrolls sideways, and its header wash stays inside`, async ({
    page,
  }) => {
    await home(page, width);
    await expect(page.locator("[data-header-wash]")).toHaveCount(1);
    // Measured once the outline has laid out: rows mount and fonts swap
    // after the first badge is visible, so a single read can see a frame
    // that is still moving.
    await expect
      .poll(async () => {
        const m = await measure(page);
        return m === null ? null : { overflow: m.overflow, pageOverflow: m.pageOverflow };
      })
      .toEqual({ overflow: 0, pageOverflow: 0 });
  });

  test(`home at ${width}px shows every child count whole`, async ({ page }) => {
    await home(page, width);
    await expect
      .poll(async () => {
        const m = await measure(page);
        if (m === null || m.badges.length === 0) return ["no count badges yet"];
        return m.badges
          .filter((badge) => badge.left < m.frameLeft)
          .map((badge) => `count ${badge.text} starts at ${badge.left}, left of ${m.frameLeft}`);
      })
      .toEqual([]);
  });
}
