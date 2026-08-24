// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_SIZE } from "./fixture";

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
    const sigma = (element as HTMLDivElement & { __kbSigma?: SigmaInspector })
      .__kbSigma;
    if (!sigma) return { total: 0, inBounds: 0 };
    const rect = element.getBoundingClientRect();
    let inBounds = 0;
    const ids = sigma.getGraph().nodes();
    for (const id of ids) {
      const display = sigma.getNodeDisplayData(id);
      if (!display) continue;
      const point = sigma.framedGraphToViewport(display);
      if (
        point.x >= 0 &&
        point.x <= rect.width &&
        point.y >= 0 &&
        point.y <= rect.height
      ) {
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
  expect(
    (await alphaBoundingBox(page, "canvas.sigma-labels")).pixels,
  ).toBeGreaterThan(0);
});

test("cluster paints labels and a hull spanning its members", async ({ page }) => {
  await selectRenderer(page, "cluster");
  const host = "[data-testid='cluster-graph'] > div";
  await expect(page.locator(`${host} canvas.sigma-labels`)).toBeVisible();
  await expect.poll(() => sigmaViewportCoverage(page, host)).toEqual({
    total: FIXTURE_SIZE,
    inBounds: FIXTURE_SIZE,
  });
  expect(
    (await alphaBoundingBox(page, `${host} canvas.sigma-labels`)).pixels,
  ).toBeGreaterThan(0);

  const hull = await alphaBoundingBox(
    page,
    "[data-testid='cluster-graph'] > canvas",
  );
  const members = await page.locator(host).evaluate((element) => {
    const sigma = (element as HTMLDivElement & { __kbSigma?: SigmaInspector })
      .__kbSigma;
    if (!sigma) return { width: 0, height: 0 };
    const points = sigma
      .getGraph()
      .nodes()
      .map((id) => sigma.getNodeDisplayData(id))
      .filter((point): point is { x: number; y: number } => !!point)
      .map((point) => sigma.framedGraphToViewport(point));
    return {
      width:
        Math.max(...points.map((point) => point.x)) -
        Math.min(...points.map((point) => point.x)),
      height:
        Math.max(...points.map((point) => point.y)) -
        Math.min(...points.map((point) => point.y)),
    };
  });
  expect(hull.width).toBeGreaterThanOrEqual(members.width * 0.6);
  expect(hull.height).toBeGreaterThanOrEqual(members.height * 0.6);
});

test("tree mounts every fixture node inside the viewport after Fit", async ({ page }) => {
  await selectRenderer(page, "tree");
  const tree = page.locator("[data-testid='tree-graph']");
  await tree.getByRole("button", { name: "Fit" }).click();
  await expect(tree.locator("svg g.cursor-pointer")).toHaveCount(FIXTURE_SIZE);
  const intersects = await tree.evaluate((element) => {
    const container = element.getBoundingClientRect();
    const svg = element.querySelector("svg")?.getBoundingClientRect();
    return (
      !!svg &&
      svg.right > container.left &&
      svg.left < container.right &&
      svg.bottom > container.top &&
      svg.top < container.bottom
    );
  });
  expect(intersects).toBe(true);
});

test("force3d receives all fixture nodes and settles to a non-degenerate volume", async ({
  page,
}) => {
  await selectRenderer(page, "force3d");
  const host = page.locator("[data-testid='force3d-graph']");
  await expect(host.locator("canvas")).toBeVisible();
  await expect.poll(async () => host.evaluate((element) => {
    const graph = (
      element as HTMLDivElement & {
        __kbForceGraph?: { graphData(): { nodes: unknown[] } };
      }
    ).__kbForceGraph;
    return graph?.graphData().nodes.length ?? 0;
  })).toBe(FIXTURE_SIZE);

  await page.waitForTimeout(3_000);
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
