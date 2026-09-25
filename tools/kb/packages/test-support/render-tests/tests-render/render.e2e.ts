// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_SIZE } from "./fixture.ts";
const runtimeErrors = new WeakMap<Page, string[]>();

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], "graph runtime errors").toEqual([]);
});

type SigmaInspector = {
  getGraph(): { nodes(): string[] };
  getNodeDisplayData(id: string): { x: number; y: number } | undefined;
  framedGraphToViewport(position: { x: number; y: number }): { x: number; y: number };
};

async function selectRenderer(page: Page, renderer: string) {
  await page.locator(`[data-renderer-button="${renderer}"]`).click();
  await expect(page.locator("[data-renderer-switch]")).toHaveAttribute(
    "data-active-renderer",
    renderer,
  );
}

async function sigmaViewportCoverage(page: Page, host: string) {
  return page.locator(host).evaluate((element) => {
    const sigma = (element as HTMLDivElement & { __kbSigma?: SigmaInspector }).__kbSigma;
    if (!sigma) return { total: 0, inBounds: 0 };
    const rect = element.getBoundingClientRect();
    let inBounds = 0;
    const ids = sigma.getGraph().nodes();
    for (const id of ids) {
      const display = sigma.getNodeDisplayData(id);
      if (!display) continue;
      const point = sigma.framedGraphToViewport(display);
      if (point.x >= 0 && point.x <= rect.width && point.y >= 0 && point.y <= rect.height) {
        inBounds += 1;
      }
    }
    return { total: ids.length, inBounds };
  });
}

async function alphaBoundingBox(page: Page, selector: string) {
  return page.locator(selector).evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("2d", { willReadFrequently: true });
    if (!context) return { pixels: 0, width: 0, height: 0 };
    const data = context.getImageData(0, 0, element.width, element.height).data;
    let minX = element.width;
    let minY = element.height;
    let maxX = -1;
    let maxY = -1;
    let pixels = 0;
    for (let y = 0; y < element.height; y += 1) {
      for (let x = 0; x < element.width; x += 1) {
        if (data[(y * element.width + x) * 4 + 3] === 0) continue;
        pixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return maxX < 0
      ? { pixels: 0, width: 0, height: 0 }
      : { pixels, width: maxX - minX + 1, height: maxY - minY + 1 };
  });
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/graph");
  await expect(page.locator("[data-renderer-switch]")).toBeVisible();
});

test("force2d paints labels and frames settled nodes", async ({ page }) => {
  await selectRenderer(page, "force2d");
  await expect(page.locator("canvas.sigma-labels")).toBeVisible();
  await expect
    .poll(() => sigmaViewportCoverage(page, "[data-sigma-container]"))
    .toEqual({ total: FIXTURE_SIZE, inBounds: FIXTURE_SIZE });
  await expect
    .poll(() => alphaBoundingBox(page, "canvas.sigma-labels"))
    .toMatchObject({ pixels: expect.any(Number) });
  expect((await alphaBoundingBox(page, "canvas.sigma-labels")).pixels).toBeGreaterThan(0);
});

test("cluster paints labels and a hull spanning its members", async ({ page }) => {
  await selectRenderer(page, "cluster");
  const host = "[data-testid='cluster-graph'] > div";
  await expect(page.locator(`${host} canvas.sigma-labels`)).toBeVisible();
  await expect
    .poll(() => sigmaViewportCoverage(page, host))
    .toEqual({
      total: FIXTURE_SIZE,
      inBounds: FIXTURE_SIZE,
    });
  expect((await alphaBoundingBox(page, `${host} canvas.sigma-labels`)).pixels).toBeGreaterThan(0);

  const hull = await alphaBoundingBox(page, "[data-testid='cluster-graph'] > canvas");
  const members = await page.locator(host).evaluate((element) => {
    const sigma = (element as HTMLDivElement & { __kbSigma?: SigmaInspector }).__kbSigma;
    if (!sigma) return { width: 0, height: 0 };
    const points = sigma
      .getGraph()
      .nodes()
      .map((id) => sigma.getNodeDisplayData(id))
      .filter((point): point is { x: number; y: number } => !!point)
      .map((point) => sigma.framedGraphToViewport(point));
    return {
      width:
        Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
      height:
        Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
    };
  });
  expect(hull.width).toBeGreaterThanOrEqual(members.width * 0.6);
  expect(hull.height).toBeGreaterThanOrEqual(members.height * 0.6);
});

test("tree fits every full label on first load and after resize", async ({ page }) => {
  await selectRenderer(page, "tree");
  const host = page.locator("[data-testid='tree-graph']");
  await expect(host.locator("[data-node-id]")).toHaveCount(FIXTURE_SIZE);
  const allLabelsFit = () =>
    host.evaluate((element) => {
      const frame = element.getBoundingClientRect();
      return [...element.querySelectorAll("[data-node-id] > text")].every((text) => {
        const box = text.getBoundingClientRect();
        return (
          box.left >= frame.left &&
          box.right <= frame.right &&
          box.top >= frame.top &&
          box.bottom <= frame.bottom
        );
      });
    });
  await expect.poll(allLabelsFit).toBe(true);
  await page.setViewportSize({ width: 760, height: 600 });
  await expect.poll(allLabelsFit).toBe(true);
  await page.getByRole("button", { name: "Collapse all", exact: true }).click();
  await page.getByRole("button", { name: "Search (/)", exact: true }).click();
  await page.getByPlaceholder("Search nodes…").fill("Fixture node 28");
  await page.getByPlaceholder("Search nodes…").press("Enter");
  await expect(host.locator('[data-node-id="render.fixture.node.28"]')).toBeVisible();
  await host.locator('[data-node-id="render.fixture.node.28"] > text').click();
  await expect(page.getByTestId("graph-selection-card")).toContainText("Fixture node 28");
});

type Force3dInspector = {
  inspect(): {
    backend: string;
    nodes: number;
    positions: Array<readonly [number, number, number]>;
    frames: number;
    bloom: boolean;
    particles: number;
    flying: boolean;
    screenOf(id: string): { x: number; y: number } | null;
  };
};

/** The 3D scene's inspection, as plain data (test-render builds only). */
async function scene3d(page: Page) {
  return page.getByTestId("force3d-graph").evaluate((element) => {
    const scene = (element as HTMLDivElement & { __kbForce3d?: Force3dInspector }).__kbForce3d;
    if (!scene) return null;
    const now = scene.inspect();
    return {
      backend: now.backend,
      nodes: now.nodes,
      positions: now.positions,
      frames: now.frames,
      bloom: now.bloom,
      particles: now.particles,
      flying: now.flying,
    };
  });
}

async function screenOf3d(page: Page, id: string) {
  return page
    .getByTestId("force3d-graph")
    .evaluate(
      (element, node) =>
        (element as HTMLDivElement & { __kbForce3d?: Force3dInspector }).__kbForce3d
          ?.inspect()
          .screenOf(node) ?? null,
      id,
    );
}

test("force3d receives all fixture nodes and settles to a non-degenerate volume", async ({
  page,
}) => {
  await selectRenderer(page, "force3d");
  const host = page.locator("[data-testid='force3d-graph']");
  await expect(host.locator("canvas")).toBeVisible();
  await expect.poll(() => scene3d(page).then((s) => s?.nodes)).toBe(FIXTURE_SIZE);

  // The layout settles in view over its cooldown; sample after it.
  await page.waitForTimeout(6_000);
  const positions = (await scene3d(page))?.positions ?? [];
  const maximumExtent = (() => {
    const extent = (axis: 0 | 1 | 2) => {
      const values = positions.map((p) => p[axis]);
      return Math.max(...values) - Math.min(...values);
    };
    return Math.max(extent(0), extent(1), extent(2));
  })();
  expect(maximumExtent).toBeGreaterThan(1);
});

test("force3d draws through the scene kit's post chain and flies to a selected node", async ({
  page,
}) => {
  await selectRenderer(page, "force3d");
  await expect.poll(() => scene3d(page).then((s) => s?.nodes)).toBe(FIXTURE_SIZE);
  expect(await scene3d(page).then((s) => s?.bloom)).toBe(true);
  expect(await scene3d(page).then((s) => s?.frames)).toBeGreaterThan(0);
  // Nothing in focus: no direction particles.
  expect(await scene3d(page).then((s) => s?.particles)).toBe(0);
  await page.waitForTimeout(4_000);
  const host = page.getByTestId("force3d-graph");
  const box = await host.boundingBox();
  const root = await screenOf3d(page, "render.fixture.root");
  if (!box || !root) throw new Error("no 3D host or root position");
  await page.mouse.click(box.x + root.x, box.y + root.y);
  await expect(page.getByTestId("graph-selection-card")).toContainText("Fixture root");
  // The selection brings its links' particles on and flies the camera to it.
  await expect.poll(() => scene3d(page).then((s) => s?.particles)).toBeGreaterThan(0);
  await expect.poll(() => scene3d(page).then((s) => s?.flying), { timeout: 5_000 }).toBe(false);
  const centred = await screenOf3d(page, "render.fixture.root");
  expect(centred).not.toBeNull();
  expect(Math.abs((centred?.x ?? 0) - box.width / 2)).toBeLessThan(box.width * 0.1);
  expect(Math.abs((centred?.y ?? 0) - box.height / 2)).toBeLessThan(box.height * 0.1);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => scene3d(page).then((s) => s?.particles)).toBe(0);
});

test("cluster selects in place, keeps camera still, and composes zero search with selection", async ({
  page,
}) => {
  await selectRenderer(page, "cluster");
  const host = page.locator("[data-sigma-container]");
  await expect(host.locator("canvas.sigma-labels")).toBeVisible();
  await expect
    .poll(() =>
      host.evaluate((element) => {
        const sigma = (element as HTMLDivElement & { __kbSigma?: SigmaInspector }).__kbSigma;
        return sigma?.getGraph().nodes().length ?? 0;
      }),
    )
    .toBe(FIXTURE_SIZE);
  const root = await host.evaluate((element) => {
    const sigma = (
      element as HTMLDivElement & {
        __kbSigma: {
          getNodeDisplayData(id: string): { x: number; y: number };
          framedGraphToViewport(p: { x: number; y: number }): { x: number; y: number };
          getCamera(): { getState(): { x: number; y: number; ratio: number } };
        };
      }
    ).__kbSigma;
    const point = sigma.framedGraphToViewport(sigma.getNodeDisplayData("render.fixture.root"));
    const box = element.getBoundingClientRect();
    return { x: box.left + point.x, y: box.top + point.y, camera: sigma.getCamera().getState() };
  });
  await page.mouse.click(root.x, root.y);
  await expect(page.getByTestId("graph-selection-card")).toContainText("Fixture root");
  await expect(page).toHaveURL(/\/graph\//);
  expect(
    await host.evaluate((element) =>
      (
        element as HTMLDivElement & { __kbSigma: { getCamera(): { getState(): unknown } } }
      ).__kbSigma
        .getCamera()
        .getState(),
    ),
  ).toEqual(root.camera);
  await page.getByRole("button", { name: "Search (/)", exact: true }).click();
  const input = page.getByPlaceholder("Search nodes…");
  await input.fill("no node has this label");
  await expect(page.getByText("0 matches", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      host.evaluate((element) => {
        const sigma = (
          element as HTMLDivElement & {
            __kbSigma: {
              getGraph(): { nodes(): string[] };
              getNodeDisplayData(id: string): { label?: string };
            };
          }
        ).__kbSigma;
        return sigma
          .getGraph()
          .nodes()
          .every((id) => {
            const label = sigma.getNodeDisplayData(id).label;
            return label === undefined || label === "";
          });
      }),
    )
    .toBe(true);
  await input.press("Escape");
  await expect(page.getByTestId("graph-selection-card")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "graph-perspective 1", exact: true }).click();
  await expect
    .poll(() =>
      host.evaluate(
        (element) =>
          (
            element as HTMLDivElement & {
              __kbSigma: { getNodeDisplayData(id: string): { label?: string } };
            }
          ).__kbSigma.getNodeDisplayData("lens.all-mentions").label,
      ),
    )
    .toBe("");
});

test("a renderer replacement survives reload on the first attempt", async ({ page }) => {
  await selectRenderer(page, "cluster");
  await page.reload();
  await expect(page.locator("[data-renderer-switch]")).toHaveAttribute(
    "data-active-renderer",
    "cluster",
  );
});

test.describe("dark Retina graph labels", () => {
  test.use({ deviceScaleFactor: 2, colorScheme: "dark" });
  test("hover labels stay high-contrast without a white plate", async ({ page }, testInfo) => {
    await selectRenderer(page, "cluster");
    const host = page.locator("[data-sigma-container]");
    const root = await host.evaluate((element) => {
      const sigma = (
        element as HTMLDivElement & {
          __kbSigma: {
            getNodeDisplayData(id: string): { x: number; y: number };
            framedGraphToViewport(p: { x: number; y: number }): { x: number; y: number };
          };
        }
      ).__kbSigma;
      const point = sigma.framedGraphToViewport(sigma.getNodeDisplayData("render.fixture.root"));
      const box = element.getBoundingClientRect();
      return { x: box.left + point.x, y: box.top + point.y };
    });
    await page.mouse.move(root.x, root.y);
    await expect(page.getByText("Fixture root", { exact: false })).toBeVisible();
    const paint = await page.locator("canvas.sigma-hovers").evaluate((canvas) => {
      const el = canvas as HTMLCanvasElement,
        ctx = el.getContext("2d");
      if (!ctx) throw new Error("missing canvas context");
      const rgba = ctx.getImageData(0, 0, el.width, el.height).data;
      let bright = 0,
        dark = 0;
      for (let i = 0; i < rgba.length; i += 4) {
        if ((rgba[i + 3] ?? 0) < 180) continue;
        const luminance = ((rgba[i] ?? 0) + (rgba[i + 1] ?? 0) + (rgba[i + 2] ?? 0)) / 3;
        if (luminance > 180) bright++;
        if (luminance < 80) dark++;
      }
      return { bright, dark, dpr: el.width / el.getBoundingClientRect().width };
    });
    expect(paint.dpr).toBe(2);
    expect(paint.bright).toBeGreaterThan(100);
    expect(paint.dark).toBeGreaterThan(100);
    await page.screenshot({ path: testInfo.outputPath("cluster-dark-retina.png") });
    await selectRenderer(page, "tree");
    await page.locator(".kb-workspace-reveal").evaluateAll(async (elements) => {
      await Promise.all(
        elements
          .flatMap((el) => el.getAnimations())
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await page.screenshot({ path: testInfo.outputPath("tree-dark-retina.png") });
    await selectRenderer(page, "force3d");
    await expect(page.getByTestId("force3d-graph").locator("canvas")).toBeVisible();
    let previous = "";
    await expect
      .poll(
        async () => {
          const next = JSON.stringify((await scene3d(page))?.positions ?? []);
          const settled =
            (JSON.parse(next) as unknown[]).length === FIXTURE_SIZE && next === previous;
          previous = next;
          return settled;
        },
        { timeout: 15000, intervals: [250, 500, 500] },
      )
      .toBe(true);
    await page.locator(".kb-workspace-reveal").evaluateAll(async (elements) => {
      await Promise.all(
        elements
          .flatMap((el) => el.getAnimations())
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await expect.poll(() => scene3d(page).then((s) => s?.frames)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("force3d-dark-retina.png") });
  });
});
