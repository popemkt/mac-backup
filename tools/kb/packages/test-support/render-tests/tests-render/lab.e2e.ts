// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// The lab studies in a real browser: each one mounts, reports the backend the
// machine offers, draws, takes a pointer, and is disposed when another study
// replaces it; and without WebGPU each one either falls back to WebGL2 or
// says why it cannot start. The unit suite mocks the scenes, so this is the
// only place the scene host, the pointer, the study switch and the fallback
// meet a GPU.
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

/** The studies in switcher order (`LAB_SCENE_IDS`); the first test holds the page to it. */
const STUDIES = ["embers", "sky", "light", "motion"] as const;
/**
 * The studies that decline to start without WebGPU. The fallback test holds
 * the page to this: without WebGPU exactly these say they cannot start.
 */
const WEBGPU_ONLY: ReadonlySet<string> = new Set(["embers"]);

/** Lazy chunks plus a shader compile: slower than expect's 5 s under software GL. */
const STUDY_READY = { timeout: 30_000 };

const runtimeErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  // The lab is an optional plugin: switch it on the way a user does.
  await page.goto("/");
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByTestId("plugin-lab").selectOption("on");
  await page.keyboard.press("Escape");
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], "lab runtime errors").toEqual([]);
});

/** The backend label the lab's header shows once a study is on screen. */
const backendLabel = (page: Page) => page.locator("header").getByText(/^(WebGPU|WebGL2)$/);
const cannotStart = (page: Page) => page.getByText("This study could not start", { exact: true });

async function openStudy(page: Page, id: string) {
  await page.goto(`/lab/${id}`);
  await expect(page.locator(`[data-lab-study="${id}"]`)).toBeVisible(STUDY_READY);
}

test("the study switch offers exactly these studies, in order", async ({ page }) => {
  await openStudy(page, STUDIES[0]);
  const switcher = page.getByRole("group", { name: "Study", exact: true });
  const buttons = switcher.getByRole("button");
  await expect(buttons).toHaveCount(STUDIES.length);
  for (const [index, id] of STUDIES.entries()) {
    await buttons.nth(index).click();
    await expect(page).toHaveURL(new RegExp(`/lab/${id}$`));
    await expect(buttons.nth(index)).toHaveAttribute("aria-pressed", "true");
  }
});

for (const [index, id] of STUDIES.entries()) {
  test(`${id} mounts on this machine's backend, draws, and is disposed on switch`, async ({
    page,
    gpu,
  }) => {
    // GAP [[01M3E6QH4WZFJQTQM96NBZ7VVA]]
    test.skip(WEBGPU_ONLY.has(id) && !gpu.webgpu, `${id} needs a WebGPU adapter`);
    await openStudy(page, id);
    await expect(backendLabel(page)).toBeVisible(STUDY_READY);
    // A study on WebGL2 where WebGPU is on offer has fallen back silently.
    await expect(backendLabel(page)).toHaveText(gpu.backend);
    const scene = page.getByTestId("lab-scene");
    const canvas = scene.locator("canvas");
    await expect(canvas).toHaveCount(1);
    // The stage keeps its canvas hidden until the first frame is compiled
    // and drawn (Lab principle P2), so a box is the sign that it has drawn.
    await expect
      .poll(async () => {
        const box = await canvas.boundingBox();
        return (box?.width ?? 0) > 0 && (box?.height ?? 0) > 0;
      }, STUDY_READY)
      .toBe(true);

    // The pointer drives every study; sweeping it must not throw.
    const box = await scene.boundingBox();
    if (!box) throw new Error("the scene has no box");
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4, { steps: 8 });

    // Switching disposes this scene: exactly one canvas, the next study's.
    const next = STUDIES[(index + 1) % STUDIES.length] ?? STUDIES[0];
    await page
      .getByRole("group", { name: "Study", exact: true })
      .getByRole("button")
      .nth((index + 1) % STUDIES.length)
      .click();
    await expect(page.locator(`[data-lab-study="${next}"]`)).toBeVisible(STUDY_READY);
    await expect(backendLabel(page).or(cannotStart(page))).toBeVisible(STUDY_READY);
    await expect(page.locator(`[data-lab-study="${id}"]`)).toHaveCount(0);
    await expect(scene.locator("canvas")).toHaveCount(WEBGPU_ONLY.has(next) && !gpu.webgpu ? 0 : 1);
  });
}

test.describe("without WebGPU", () => {
  test.beforeEach(async ({ page }) => {
    // What a browser with no WebGPU looks like to three: no `navigator.gpu`.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined });
    });
  });

  for (const id of STUDIES) {
    test(`${id} falls back to WebGL2 or says why it cannot start`, async ({ page }) => {
      await openStudy(page, id);
      if (WEBGPU_ONLY.has(id)) {
        await expect(cannotStart(page)).toBeVisible(STUDY_READY);
        await expect(page.getByText(/needs WebGPU/)).toBeVisible();
        await expect(backendLabel(page)).toHaveCount(0);
      } else {
        await expect(backendLabel(page)).toHaveText("WebGL2", STUDY_READY);
        await expect(cannotStart(page)).toHaveCount(0);
      }
    });
  }
});
