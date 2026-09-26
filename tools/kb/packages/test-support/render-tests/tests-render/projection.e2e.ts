import { fieldTypeValue, type FieldType } from "@kb/model";
import { expect, settledBox, test } from "./harness-test.ts";

test("collapse holds the camera; mapped perspectives save as node references and survive reload", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const action = async (id: string, input: Record<string, unknown>) => {
    const response = await request.post("/api/action", { data: { id, input } });
    const receipt = await response.json();
    expect(receipt.status, JSON.stringify(receipt)).toBe("succeeded");
    return receipt;
  };
  await page.goto("/graph");
  await page.locator('[data-renderer-button="tree"]').click();
  const tree = page.getByTestId("tree-graph");
  const branch = tree.locator('[data-node-id="render.fixture.root"]');
  await expect(branch).toBeVisible();
  // Tree moves ease (zoom, collapse, arrival): measure places once they have settled.
  await page.getByRole("button", { name: "Zoom in (+)", exact: true }).click();
  const before = await settledBox(branch);
  const count = await tree.locator("[data-node-id]").count();
  await branch.getByRole("button", { name: "Collapse Fixture root", exact: true }).click();
  await expect.poll(() => tree.locator("[data-node-id]").count()).toBeLessThan(count);
  const collapsed = await settledBox(branch);
  expect(collapsed.x).toBeCloseTo(before.x, 0);
  expect(collapsed.y).toBeCloseTo(before.y, 0);
  expect(collapsed.width).toBeCloseTo(before.width, 0);
  await branch.getByRole("button", { name: "Expand Fixture root", exact: true }).click();
  await expect(tree.locator("[data-node-id]")).toHaveCount(count);

  const fields: Array<[id: string, name: string, type: FieldType]> = [
    ["render.field.area", "Reading weight", "number"],
    ["render.field.group", "Topic", "text"],
    ["render.field.label", "Short name", "text"],
  ];
  for (const [id, name, type] of fields) {
    await action("node.add", {
      id,
      text: name,
      tags: ["sys.field"],
      props: [{ field: "sys.f.fieldType", value: fieldTypeValue(type) }],
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

  // Save a copy once the server holds every mapping just chosen: each
  // choice is its own write, and a copy taken while one is still in flight
  // saves the perspective without it.
  const mapped = { "sys.f.lens.size-by": "area", "sys.f.lens.label-by": "label" };
  await expect
    .poll(async () => {
      const receipt = await action("node.get", { id: "lens.all-mentions" });
      const props = receipt.output.node.props as Record<string, unknown>;
      return Object.entries(mapped).every(
        ([field, name]) =>
          JSON.stringify(props[field]) ===
          JSON.stringify([{ t: "ref", v: `render.field.${name}` }]),
      );
    })
    .toBe(true);
  await page.getByRole("button", { name: "Perspective", exact: true }).click();
  await page.getByRole("textbox", { name: "Perspective name" }).fill("Topics by reading weight");
  await page.getByRole("button", { name: "Save as new perspective" }).click();
  await expect(page.getByRole("button", { name: "Perspective", exact: true })).toContainText(
    "Topics by reading weight",
  );
  const savedPath = new URL(page.url()).pathname;
  expect(savedPath).not.toBe("/graph/lens.all-mentions");
  const savedId = decodeURIComponent(savedPath.split("/").at(-1) ?? "");
  // Reload once the server holds the new perspective. The URL moves on the
  // optimistic write; a reload before the server has it opens a node that is
  // not there, and `/graph/<missing>` quietly shows All mentions instead.
  await expect
    .poll(async () => {
      const response = await request.post("/api/action", {
        data: { id: "node.get", input: { id: savedId } },
      });
      return ((await response.json()) as { status: string }).status;
    })
    .toBe("succeeded");
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
  const receipt = await action("node.get", { id: savedId });
  expect(receipt.output.node.props["sys.f.lens.renderer"]).toEqual([
    { t: "ref", v: "sys.graph.renderer.treemap" },
  ]);
  expect(receipt.output.node.props["sys.f.lens.size-by"]).toEqual([
    { t: "ref", v: "render.field.area" },
  ]);
  await page.screenshot({ path: testInfo.outputPath("projection-treemap.png") });
  expect(errors).toEqual([]);
});
