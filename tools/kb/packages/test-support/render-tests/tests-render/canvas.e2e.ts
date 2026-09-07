import { present } from "@kb/model";
import { expect, test } from "playwright/test";
import { startHarness } from "./harness-server";

let harness: Awaited<ReturnType<typeof startHarness>>;
test.beforeAll(async () => {
  harness = await startHarness(4328);
});
test.afterAll(async () => {
  await harness.stop();
});

test("reference cards have usable handles and connection preview follows the cursor through zoom", async ({
  page,
  request,
}) => {
  const canvasId = "render.canvas.polish";
  const response = await request.post(`${harness.url}/api/action`, {
    data: {
      id: "node.add",
      input: {
        id: canvasId,
        text: "Spatial study",
        tags: ["sys.tag.canvas"],
        props: [
          {
            field: "sys.f.canvas",
            value: {
              t: "str",
              v: JSON.stringify({
                nodes: [
                  {
                    id: "reference",
                    type: "kb-node",
                    nodeId: "render.fixture.root",
                    x: 100,
                    y: 140,
                    width: 280,
                    height: 100,
                  },
                  {
                    id: "idea",
                    type: "shape",
                    shape: "rect",
                    label: "A connected idea",
                    x: 520,
                    y: 260,
                    width: 220,
                    height: 120,
                  },
                  {
                    id: "note",
                    type: "text",
                    text: "A canvas for thinking spatially",
                    x: 450,
                    y: 60,
                    width: 260,
                    height: 100,
                  },
                ],
                edges: [],
              }),
            },
          },
        ],
      },
    },
  });
  expect((await response.json()).status).toBe("succeeded");
  await page.goto(`${harness.url}/canvas/${canvasId}`);
  const viewport = page.locator("[data-canvas-viewport]");
  await expect(viewport).toBeVisible();
  const reference = page.locator('[data-card-id="reference"] .group\\/card');
  await expect(reference).toBeVisible();
  await expect(page.getByText("A connected idea", { exact: true })).toBeVisible();
  const rect = present(await reference.boundingBox(), "reference bounds");
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const port = reference.getByRole("button", { name: "Connect right" });
  await expect(port).toBeVisible();
  const hit = present(await port.boundingBox(), "port bounds");
  expect(hit.width).toBeGreaterThanOrEqual(24);
  // The outward half of the port must remain clickable, not clipped by the card.
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest("[data-port]")?.getAttribute("data-port"),
      { x: hit.x + hit.width - 2, y: hit.y + hit.height / 2 },
    ),
  ).toBe("right");
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -90);
  await page.keyboard.up("Control");
  const zoomedHit = present(await port.boundingBox(), "port bounds");
  await page.mouse.move(zoomedHit.x + zoomedHit.width / 2, zoomedHit.y + zoomedHit.height / 2);
  await page.mouse.down();
  await page.mouse.move(810, 510, { steps: 5 });
  const preview = page.getByTestId("canvas-connection-preview");
  await expect(preview).toBeVisible();
  const end = await preview.evaluate((path) => {
    const curve = path as SVGPathElement;
    const matrix = curve.getScreenCTM();
    if (!matrix) throw new Error("Connection preview has no screen transform");
    const point = curve.getPointAtLength(curve.getTotalLength()).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
  expect(end.x).toBeCloseTo(810, 0);
  expect(end.y).toBeCloseTo(510, 0);
  await page.screenshot({ path: "/tmp/kb-canvas-polish.png" });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
});
