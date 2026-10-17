/**
 * The 3D canvas's round trip, as one scenario the backend specs share
 * (`canvas3d.e2e.ts` on whatever the machine offers, `canvas3d-webgl2.e2e.ts`
 * with WebGPU hidden from the page): into depth, the scene drawing every item
 * on the expected backend without an error, and back to 2D with the pose
 * remembered.
 */
import type { APIRequestContext, Page, TestInfo } from "playwright/test";
import { SYSTEM_IDS } from "@kb/model";
import { expect } from "./harness-test.ts";

/** What the 3D canvas's host exposes in a render build (`canvas-3d-stage`). */
interface Inspection {
  backend: string;
  frames: number;
  items: string[];
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

function inspect(el: Element) {
  const scene = (el as HTMLElement & { __kbCanvas3d?: { inspect(): Inspection } }).__kbCanvas3d;
  const view = scene?.inspect();
  return view === undefined
    ? null
    : {
        backend: view.backend,
        frames: view.frames,
        items: view.items,
        flat: view.screenOf("flat"),
        raised: view.screenOf("raised"),
      };
}

export async function crossIntoDepth(
  {
    page,
    request,
    backend,
  }: { page: Page; request: APIRequestContext; backend: "WebGPU" | "WebGL2" },
  testInfo: TestInfo,
): Promise<void> {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /webgl|webgpu|shader|texture|three/i.test(message.text())) {
      failures.push(message.text());
    }
  });
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
  await expect.poll(async () => (await host.evaluate(inspect))?.backend ?? null).toBe(backend);
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath("canvas-transition.png") });
  await page.waitForTimeout(1600);
  const inspected = await host.evaluate(inspect);
  expect(inspected?.items.toSorted()).toEqual(["flat", "idea", "raised"]);
  expect(inspected?.frames).toBeGreaterThan(1);
  // The camera flew out to a pose that still frames the cards.
  expect(inspected?.flat).not.toBeNull();
  expect(inspected?.raised).not.toBeNull();
  await page.screenshot({ path: testInfo.outputPath("canvas-3d.png") });

  // Back to 2D: the DOM canvas takes over again, looking at the same place.
  await page.getByRole("button", { name: "2D projection" }).click();
  await expect(host).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('[data-card-id="raised"] .group\\/card')).toBeVisible();
  // The canvas's view node remembers it is flat now, and the pose it was
  // looked at from in depth; the document holds no camera.
  const props = async (id: string) => {
    const got = await request.post("/api/action", { data: { id: "node.get", input: { id } } });
    const receipt = (await got.json()) as {
      output?: { node: { props: Record<string, { t: string; v: string }[]> } };
    };
    return receipt.output?.node.props ?? {};
  };
  const camera = async () => {
    const canvas = await props(canvasId);
    for (const view of canvas[SYSTEM_IDS.viewsField] ?? []) {
      const held = await props(view.v);
      if (held[SYSTEM_IDS.viewField]?.[0]?.v !== "sys.view.canvas.page") continue;
      return {
        projection: held["sys.f.canvas.projection"]?.[0]?.v ?? null,
        pose: held["sys.f.canvas.pose"]?.[0]?.v !== undefined,
        doc: "camera" in JSON.parse(canvas["sys.f.canvas"]?.[0]?.v ?? "{}"),
      };
    }
    return null;
  };
  await expect
    .poll(camera)
    .toEqual({ projection: "sys.canvas-projection.2d", pose: true, doc: false });
  expect(failures).toEqual([]);
}
