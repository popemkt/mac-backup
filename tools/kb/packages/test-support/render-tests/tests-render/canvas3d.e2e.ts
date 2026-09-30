import { expect, test } from "./harness-test.ts";

/** What the 3D canvas's host exposes in a render build (`canvas-3d-stage`, `CanvasSceneInspection`). */
interface Inspection {
  backend: string;
  frames: number;
  items: string[];
  selected: string[];
  screenOf(id: string): { x: number; y: number } | null;
}

const doc = {
  nodes: [
    { id: "flat", type: "text", text: "On the canvas plane", x: 80, y: 80, width: 260, height: 90 },
    {
      id: "raised",
      type: "text",
      text: "Lifted toward the viewer",
      x: 420,
      y: 140,
      width: 260,
      height: 90,
      z: 160,
    },
    {
      id: "idea",
      type: "shape",
      shape: "ellipse",
      label: "Idea",
      x: 200,
      y: 280,
      width: 160,
      height: 90,
    },
  ],
  edges: [{ id: "e", fromNode: "flat", toNode: "raised", toEnd: "arrow" }],
};

test("a canvas crosses into depth and back through one camera", async ({
  page,
  request,
  gpu,
}, testInfo) => {
  const canvasId = "render.canvas.depth";
  const response = await request.post("/api/action", {
    data: {
      id: "node.add",
      input: {
        id: canvasId,
        text: "Depth",
        tags: ["sys.tag.canvas"],
        props: [{ field: "sys.f.canvas", value: { t: "str", v: JSON.stringify(doc) } }],
      },
    },
  });
  expect((await response.json()).status).toBe("succeeded");
  await page.goto(`/canvas/${canvasId}`);
  await expect(page.locator('[data-card-id="raised"] .group\\/card')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("canvas-2d.png") });

  await page.getByRole("button", { name: "3D projection" }).click();
  const host = page.getByTestId("canvas-3d");
  await expect(host).toBeVisible();
  // The scene draws on the backend this machine offers, and every item is in it.
  await expect
    .poll(() =>
      host.evaluate((el) => {
        const scene = (el as HTMLElement & { __kbCanvas3d?: { inspect(): Inspection } })
          .__kbCanvas3d;
        return scene?.inspect().backend ?? null;
      }),
    )
    .toBe(gpu.backend);
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath("canvas-transition.png") });
  await page.waitForTimeout(1600);
  const inspected = await host.evaluate((el) => {
    const scene = (el as HTMLElement & { __kbCanvas3d?: { inspect(): Inspection } }).__kbCanvas3d;
    const view = scene?.inspect();
    return view
      ? { items: view.items, flat: view.screenOf("flat"), raised: view.screenOf("raised") }
      : null;
  });
  expect(inspected?.items.toSorted()).toEqual(["flat", "idea", "raised"]);
  // The camera flew out to a pose that still frames the cards.
  expect(inspected?.flat).not.toBeNull();
  expect(inspected?.raised).not.toBeNull();
  await page.screenshot({ path: testInfo.outputPath("canvas-3d.png") });

  // Back to 2D: the DOM canvas takes over again, looking at the same place.
  await page.getByRole("button", { name: "2D projection" }).click();
  await expect(host).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('[data-card-id="raised"] .group\\/card')).toBeVisible();
  const stored = await request.post("/api/action", {
    data: { id: "node.get", input: { id: canvasId } },
  });
  const node = (await stored.json()) as {
    output: { node: { props: Record<string, { v: string }[]> } };
  };
  const saved = JSON.parse(node.output.node.props["sys.f.canvas"]?.[0]?.v ?? "{}") as {
    camera?: { projection: string; pose?: unknown };
  };
  // The canvas remembers it is flat now, and the pose it was looked at from in depth.
  expect(saved.camera?.projection).toBe("2d");
  expect(saved.camera?.pose).toBeDefined();
});
