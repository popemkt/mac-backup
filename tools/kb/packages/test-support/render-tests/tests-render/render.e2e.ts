// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// Nothing here sleeps. A renderer's internals (`__kbSigma`, `__kbForce3d`)
// appear only once its chunk has loaded and its first graph is in, so every
// read of them is a poll, and "the layout has settled" is a poll too: two
// samples in a row with the same positions.
import type { Page } from "playwright/test";
import { graphRendererId } from "@kb/model";
import { FIXTURE_SIZE } from "./fixture.ts";
import { expect, test } from "./harness-test.ts";

const runtimeErrors = new WeakMap<Page, string[]>();

/** The graph and renderer chunks load lazily; on a busy machine that takes longer than expect's 5 s. */
const PAGE_READY = { timeout: 20_000 };
/** A force layout cools over seconds, and under software GL it is slower still. */
const SETTLE = { timeout: 30_000, intervals: [250, 500] };

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], "graph runtime errors").toEqual([]);
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/graph");
  await expect(page.locator("[data-renderer-switch]")).toBeVisible(PAGE_READY);
});

type SigmaInspector = {
  getGraph(): { nodes(): string[] };
  getNodeDisplayData(id: string): { x: number; y: number; label?: string } | undefined;
  framedGraphToViewport(position: { x: number; y: number }): { x: number; y: number };
  getCamera(): { getState(): { x: number; y: number; ratio: number } };
};
type SigmaHost = HTMLDivElement & { __kbSigma?: SigmaInspector };

async function selectRenderer(page: Page, renderer: string) {
  await page.locator(`[data-renderer-button="${renderer}"]`).click();
  await expect(page.locator("[data-renderer-switch]")).toHaveAttribute(
    "data-active-renderer",
    renderer,
  );
}

/** Wait until the sigma renderer under `host` holds every fixture node. */
async function sigmaReady(page: Page, host: string) {
  await expect
    .poll(() =>
      page
        .locator(host)
        .evaluate((element) => (element as SigmaHost).__kbSigma?.getGraph().nodes().length ?? 0),
    )
    .toBe(FIXTURE_SIZE);
}

/**
 * A node's page position under the sigma renderer at `host`, once its layout
 * has stopped moving: a position read mid-layout is somewhere the node no
 * longer is by the time the pointer gets there.
 */
async function sigmaPagePoint(page: Page, host: string, id: string) {
  await sigmaReady(page, host);
  let previous = "";
  await expect
    .poll(async () => {
      const next = await page.locator(host).evaluate((element) => {
        const sigma = (element as SigmaHost).__kbSigma;
        if (!sigma) return "";
        return JSON.stringify(
          sigma
            .getGraph()
            .nodes()
            .map((node) => {
              const display = sigma.getNodeDisplayData(node);
              return display ? sigma.framedGraphToViewport(display) : null;
            }),
        );
      });
      const still = next !== "" && next === previous;
      previous = next;
      return still;
    }, SETTLE)
    .toBe(true);
  return page.locator(host).evaluate((element, node) => {
    const sigma = (element as SigmaHost).__kbSigma;
    const display = sigma?.getNodeDisplayData(node);
    if (!sigma || !display) throw new Error(`${node} is not drawn`);
    const point = sigma.framedGraphToViewport(display);
    const box = element.getBoundingClientRect();
    return { x: box.left + point.x, y: box.top + point.y, camera: sigma.getCamera().getState() };
  }, id);
}

async function sigmaViewportCoverage(page: Page, host: string) {
  return page.locator(host).evaluate((element) => {
    const sigma = (element as SigmaHost).__kbSigma;
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

/** Every workspace reveal animation has finished. */
async function revealed(page: Page) {
  await page.locator(".kb-workspace-reveal").evaluateAll(async (elements) => {
    await Promise.all(
      elements
        .flatMap((el) => el.getAnimations())
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}

test("force2d paints labels and frames settled nodes", async ({ page }) => {
  await selectRenderer(page, "force2d");
  await expect(page.locator("canvas.sigma-labels")).toBeVisible(PAGE_READY);
  await expect
    .poll(() => sigmaViewportCoverage(page, "[data-sigma-container]"))
    .toEqual({ total: FIXTURE_SIZE, inBounds: FIXTURE_SIZE });
  await expect
    .poll(() => alphaBoundingBox(page, "canvas.sigma-labels").then((box) => box.pixels))
    .toBeGreaterThan(0);
});

test("cluster paints labels and a hull spanning its members", async ({ page }) => {
  await selectRenderer(page, "cluster");
  const host = "[data-testid='cluster-graph'] > div";
  await expect(page.locator(`${host} canvas.sigma-labels`)).toBeVisible(PAGE_READY);
  await expect
    .poll(() => sigmaViewportCoverage(page, host))
    .toEqual({
      total: FIXTURE_SIZE,
      inBounds: FIXTURE_SIZE,
    });
  await expect
    .poll(() => alphaBoundingBox(page, `${host} canvas.sigma-labels`).then((box) => box.pixels))
    .toBeGreaterThan(0);

  const members = await page.locator(host).evaluate((element) => {
    const sigma = (element as SigmaHost).__kbSigma;
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
  // The hulls are drawn after the layout frames its members: poll for them.
  await expect
    .poll(async () => {
      const hull = await alphaBoundingBox(page, "[data-testid='cluster-graph'] > canvas");
      return hull.width >= members.width * 0.6 && hull.height >= members.height * 0.6;
    })
    .toBe(true);
});

test("tree fits every full label on first load and after resize", async ({ page }) => {
  await selectRenderer(page, "tree");
  const host = page.getByTestId("tree-graph");
  await expect(host.locator("[data-node-id]")).toHaveCount(FIXTURE_SIZE, PAGE_READY);
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
  await page.getByPlaceholder("Search nodes…", { exact: true }).fill("Fixture node 28");
  await page.getByPlaceholder("Search nodes…", { exact: true }).press("Enter");
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
type Force3dHost = HTMLDivElement & { __kbForce3d?: Force3dInspector };

/** The 3D scene's inspection, as plain data (test-render builds only). */
async function scene3d(page: Page) {
  return page.getByTestId("force3d-graph").evaluate((element) => {
    const scene = (element as Force3dHost).__kbForce3d;
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
      (element, node) => (element as Force3dHost).__kbForce3d?.inspect().screenOf(node) ?? null,
      id,
    );
}

/**
 * Wait until the 3D layout holds every fixture node and has stopped moving:
 * two samples in a row with the same positions and no camera flight.
 */
async function settled3d(page: Page) {
  let previous = "";
  await expect
    .poll(async () => {
      const scene = await scene3d(page);
      const next = JSON.stringify(scene?.positions ?? []);
      const still =
        scene !== null &&
        scene.nodes === FIXTURE_SIZE &&
        !scene.flying &&
        scene.frames > 0 &&
        next === previous;
      previous = next;
      return still;
    }, SETTLE)
    .toBe(true);
}

test("force3d settles to a non-degenerate volume on the backend this machine offers", async ({
  page,
  gpu,
}) => {
  await selectRenderer(page, "force3d");
  await expect(page.getByTestId("force3d-graph").locator("canvas")).toBeVisible(PAGE_READY);
  await settled3d(page);
  const scene = await scene3d(page);
  // A WebGL2 fall back where WebGPU is on offer is a regression, not a pass.
  expect(scene?.backend).toBe(gpu.backend);
  const positions = scene?.positions ?? [];
  const extent = (axis: 0 | 1 | 2) => {
    const values = positions.map((p) => p[axis]);
    return Math.max(...values) - Math.min(...values);
  };
  expect(Math.max(extent(0), extent(1), extent(2))).toBeGreaterThan(1);
});

test("force3d draws through the scene kit's post chain and flies to a selected node", async ({
  page,
}) => {
  await selectRenderer(page, "force3d");
  await settled3d(page);
  const scene = await scene3d(page);
  expect(scene?.bloom).toBe(true);
  // Nothing in focus: no direction particles.
  expect(scene?.particles).toBe(0);
  const host = page.getByTestId("force3d-graph");
  const box = await host.boundingBox();
  const root = await screenOf3d(page, "render.fixture.root");
  if (!box || !root) throw new Error("no 3D host or root position");
  await page.mouse.click(box.x + root.x, box.y + root.y);
  await expect(page.getByTestId("graph-selection-card")).toContainText("Fixture root");
  // The selection brings its links' particles on and flies the camera to it.
  await expect.poll(() => scene3d(page).then((s) => s?.particles)).toBeGreaterThan(0);
  await expect.poll(() => scene3d(page).then((s) => s?.flying), SETTLE).toBe(false);
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
  await expect(host.locator("canvas.sigma-labels")).toBeVisible(PAGE_READY);
  const root = await sigmaPagePoint(page, "[data-sigma-container]", "render.fixture.root");
  await page.mouse.click(root.x, root.y);
  await expect(page.getByTestId("graph-selection-card")).toContainText("Fixture root");
  await expect(page).toHaveURL(/\/graph\//);
  expect(
    await host.evaluate((element) => (element as SigmaHost).__kbSigma?.getCamera().getState()),
  ).toEqual(root.camera);
  await page.getByRole("button", { name: "Search (/)", exact: true }).click();
  const input = page.getByPlaceholder("Search nodes…", { exact: true });
  await input.fill("no node has this label");
  await expect(page.getByText("0 matches", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      host.evaluate((element) => {
        const sigma = (element as SigmaHost).__kbSigma;
        if (!sigma) return false;
        return sigma
          .getGraph()
          .nodes()
          .every((id) => {
            const label = sigma.getNodeDisplayData(id)?.label;
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
          (element as SigmaHost).__kbSigma?.getNodeDisplayData("lens.all-mentions")?.label,
      ),
    )
    .toBe("");
});

test("a renderer replacement survives reload on the first attempt", async ({ page }) => {
  // Reload once the server has the replacement, not merely the optimistic
  // replica: a reload inside that window loses the write by design.
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/action") &&
      (response.request().postData() ?? "").includes(graphRendererId("cluster")),
  );
  await selectRenderer(page, "cluster");
  await saved;
  await page.reload();
  await expect(page.locator("[data-renderer-switch]")).toHaveAttribute(
    "data-active-renderer",
    "cluster",
    PAGE_READY,
  );
});

test.describe("dark Retina graph labels", () => {
  test.use({ deviceScaleFactor: 2, colorScheme: "dark" });
  test("hover labels stay high-contrast without a white plate", async ({ page }, testInfo) => {
    await selectRenderer(page, "cluster");
    const root = await sigmaPagePoint(page, "[data-sigma-container]", "render.fixture.root");
    await page.mouse.move(root.x, root.y);
    // The hover label is drawn on the hover canvas, not in the DOM: wait for
    // its paint rather than for any text that happens to say "Fixture root".
    const hoverPaint = () =>
      page.locator("canvas.sigma-hovers").evaluate((canvas) => {
        const el = canvas as HTMLCanvasElement;
        const ctx = el.getContext("2d");
        if (!ctx) throw new Error("missing canvas context");
        const rgba = ctx.getImageData(0, 0, el.width, el.height).data;
        let bright = 0;
        let dark = 0;
        for (let i = 0; i < rgba.length; i += 4) {
          if ((rgba[i + 3] ?? 0) < 180) continue;
          const luminance = ((rgba[i] ?? 0) + (rgba[i + 1] ?? 0) + (rgba[i + 2] ?? 0)) / 3;
          if (luminance > 180) bright++;
          if (luminance < 80) dark++;
        }
        return { bright, dark, dpr: el.width / el.getBoundingClientRect().width };
      });
    await expect
      .poll(async () => {
        const paint = await hoverPaint();
        return paint.dpr === 2 && paint.bright > 100 && paint.dark > 100;
      })
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("cluster-dark-retina.png") });
    await selectRenderer(page, "tree");
    await revealed(page);
    await page.screenshot({ path: testInfo.outputPath("tree-dark-retina.png") });
    await selectRenderer(page, "force3d");
    await expect(page.getByTestId("force3d-graph").locator("canvas")).toBeVisible(PAGE_READY);
    await settled3d(page);
    await revealed(page);
    await page.screenshot({ path: testInfo.outputPath("force3d-dark-retina.png") });
  });
});
