import { expect, test } from "playwright/test";
import { startHarness } from "./harness-server.ts";

let harness: Awaited<ReturnType<typeof startHarness>>;
test.beforeAll(async () => {
  harness = await startHarness(4329);
});
test.afterAll(async () => {
  await harness.stop();
});

test("collapse holds the camera; mapped perspectives save as node references and survive reload", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const action = async (id: string, input: Record<string, unknown>) => {
    const response = await request.post(`${harness.url}/api/action`, { data: { id, input } });
    const receipt = await response.json();
    expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
    return receipt;
  };
  await page.goto(`${harness.url}/graph`);
  await page.locator('[data-renderer-button="tree"]').click();
  const tree = page.getByTestId("tree-graph");
  const branch = tree.locator('[data-node-id="render.fixture.root"]');
  await expect(branch).toBeVisible();
  await page.getByRole("button", { name: "Zoom in (+)", exact: true }).click();
  const before = await branch.boundingBox();
  if (!before) throw new Error("branch must have bounds");
  const count = await tree.locator("[data-node-id]").count();
  await branch.getByRole("button", { name: "Collapse Fixture root", exact: true }).click();
  await expect.poll(() => tree.locator("[data-node-id]").count()).toBeLessThan(count);
  const collapsed = await branch.boundingBox();
  if (!collapsed) throw new Error("collapsed branch must remain visible");
  expect(collapsed.x).toBeCloseTo(before.x, 0);
  expect(collapsed.y).toBeCloseTo(before.y, 0);
  expect(collapsed.width).toBeCloseTo(before.width, 0);
  await branch.getByRole("button", { name: "Expand Fixture root", exact: true }).click();
  await expect(tree.locator("[data-node-id]")).toHaveCount(count);

  for (const [id, name, type] of [
    ["render.field.area", "Reading weight", "number"],
    ["render.field.group", "Topic", "text"],
    ["render.field.label", "Short name", "text"],
  ]) {
    await action("node.add", {
      id,
      text: name,
      tags: ["sys.field"],
      props: [{ field: "sys.f.fieldType", value: { t: "str", v: type } }],
    });
  }
  for (const [index, weight, topic, label] of [
    [1, 9, "Research", "Ideas worth connecting"],
    [2, 3, "Writing", "An emerging question"],
  ]) {
    await action("node.update", {
      id: `render.fixture.node.${index}`,
      setProps: [
        { field: "render.field.area", value: { t: "num", v: weight } },
        { field: "render.field.group", value: { t: "str", v: topic } },
        { field: "render.field.label", value: { t: "str", v: label } },
      ],
    });
  }
  await page.locator('[data-renderer-button="treemap"]').click();
  await page.getByRole("button", { name: "Graph settings", exact: true }).click();
  await page.getByLabel("Area by", { exact: true }).selectOption("prop:render.field.area");
  await page.getByLabel("Group by", { exact: true }).selectOption("prop:render.field.group");
  await page.getByLabel("Color by", { exact: true }).selectOption("prop:render.field.group");
  await page.getByLabel("Label from", { exact: true }).selectOption("prop:render.field.label");
  await page.getByRole("button", { name: "Graph settings", exact: true }).click();
  const research = page.locator('[data-treemap-node="render.fixture.node.1"]');
  const writing = page.locator('[data-treemap-node="render.fixture.node.2"]');
  await expect(research).toHaveAttribute("aria-label", "Ideas worth connecting");
  await expect(page.locator("[data-treemap-node]")).toHaveCount(2);
  await page.getByTitle("Dim Research", { exact: true }).click();
  await expect(research).toHaveCSS("opacity", "0.2");
  await expect(writing).toHaveCSS("opacity", "1");
  await page.getByTitle("Restore Research", { exact: true }).click();
  await expect(research).toHaveCSS("opacity", "1");

  await page.getByRole("button", { name: "Perspective", exact: true }).click();
  await page.getByRole("textbox", { name: "Perspective name" }).fill("Topics by reading weight");
  await page.getByRole("button", { name: "Save as new perspective" }).click();
  await expect(page.getByRole("button", { name: "Perspective", exact: true })).toContainText(
    "Topics by reading weight",
  );
  const savedPath = new URL(page.url()).pathname;
  expect(savedPath).not.toBe("/graph/lens.all-mentions");
  await page.reload();
  await expect(page.locator("[data-renderer-switch]")).toHaveAttribute(
    "data-active-renderer",
    "treemap",
  );
  await expect(research).toHaveAttribute("aria-label", "Ideas worth connecting");
  await page.getByRole("button", { name: "Graph settings", exact: true }).click();
  await expect(page.getByLabel("Area by", { exact: true })).toHaveValue("prop:render.field.area");
  await expect(page.getByLabel("Group by", { exact: true })).toHaveValue("prop:render.field.group");
  await page.getByRole("button", { name: "Graph settings", exact: true }).click();
  const receipt = await action("node.get", {
    id: decodeURIComponent(savedPath.split("/").at(-1) ?? ""),
  });
  expect(receipt.output.node.props["sys.f.lens.renderer"]).toEqual([
    { t: "ref", v: "sys.graph.renderer.treemap" },
  ]);
  expect(receipt.output.node.props["sys.f.lens.size-by"]).toEqual([
    { t: "ref", v: "render.field.area" },
  ]);
  await page.screenshot({ path: "/tmp/kb-projection-treemap.png" });
  expect(errors).toEqual([]);
});
