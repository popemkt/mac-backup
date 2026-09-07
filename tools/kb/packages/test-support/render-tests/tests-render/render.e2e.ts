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

test("force3d receives all fixture nodes and settles to a non-degenerate volume", async ({
  page,
}) => {
  await selectRenderer(page, "force3d");
  const host = page.locator("[data-testid='force3d-graph']");
  await expect(host.locator("canvas")).toBeVisible();
  await expect
    .poll(async () =>
      host.evaluate((element) => {
        const graph = (
          element as HTMLDivElement & {
            __kbForceGraph?: { graphData(): { nodes: unknown[] } };
          }
        ).__kbForceGraph;
        return graph?.graphData().nodes.length ?? 0;
      }),
    )
    .toBe(FIXTURE_SIZE);

  // The historical uncooled cluster force contracts throughout the simulation;
  // sample after its default cooldown window rather than its initial spread.
  await page.waitForTimeout(10_000);
  const maximumExtent = await host.evaluate((element) => {
    const graph = (
      element as HTMLDivElement & {
        __kbForceGraph?: {
          graphData(): { nodes: Array<{ x?: number; y?: number; z?: number }> };
        };
      }
    ).__kbForceGraph;
    const nodes = graph?.graphData().nodes ?? [];
    const extent = (axis: "x" | "y" | "z") => {
      const values = nodes.map((node) => node[axis] ?? 0);
      return Math.max(...values) - Math.min(...values);
    };
    return Math.max(extent("x"), extent("y"), extent("z"));
  });
  expect(maximumExtent).toBeGreaterThan(1);
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
          const next = await page.getByTestId("force3d-graph").evaluate((el) =>
            JSON.stringify(
              (
                el as HTMLDivElement & {
                  __kbForceGraph: {
                    graphData(): { nodes: Array<{ x?: number; y?: number; z?: number }> };
                  };
                }
              ).__kbForceGraph
                .graphData()
                .nodes.map((n) => [n.x, n.y, n.z]),
            ),
          );
          const settled = JSON.parse(next).length === FIXTURE_SIZE && next === previous;
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
    await expect
      .poll(() =>
        page.getByTestId("force3d-graph").evaluate(
          (el) =>
            (
              el as HTMLDivElement & {
                __kbForceGraph: { renderer(): { info: { render: { calls: number } } } };
              }
            ).__kbForceGraph.renderer().info.render.calls,
        ),
      )
      .toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath("force3d-dark-retina.png") });
  });
});
