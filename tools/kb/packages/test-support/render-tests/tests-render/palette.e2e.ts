// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// These drive the real palette against a real store. The lesson from i13's
// dead graph toolbar is that a command can render, read correctly, and pass
// every unit assertion while its effect never lands — so the only assertion
// worth making about a new gesture is that invoking it changed the document.
import type { Page } from "playwright/test";
import { expect, test } from "./harness-test.ts";

// The fixture leaves sit collapsed under this root, so these two are the rows
// reliably on screen at "/". Every test writes to its own store (the
// `harness` fixture), so no promotion here can reach another test.
const ROOT = "render.fixture.root";
const PERSPECTIVE = "lens.all-mentions";

async function openPaletteOn(page: Page, nodeId: string) {
  await page.locator(`[data-node-id="${nodeId}"] .node-content`).first().click();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  return palette;
}

async function runCommand(page: Page, nodeId: string, label: string) {
  const palette = await openPaletteOn(page, nodeId);
  await page.keyboard.type(label);
  await expect(palette.getByRole("button", { name: label })).toBeVisible();
  await page.keyboard.press("Enter");
  return palette;
}

test("Make supertag promotes the node and takes the user to its schema", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(`[data-node-id="${ROOT}"]`).first()).toBeVisible();
  // Not schema yet: no field-template editor anywhere.
  await expect(page.locator("[data-tag-fields-config]")).toHaveCount(0);

  await runCommand(page, ROOT, "Make supertag");

  // The field template it now owns is reachable — hanging fields off a tag is
  // the entire reason to promote something.
  await expect(page.locator("[data-tag-fields-config]")).toBeVisible();
  await expect(page.getByLabel("Add a field to this tag")).toBeVisible();

  // And this is why the gesture navigates rather than just writing: a tag node
  // is schema, so forestRootIds stops listing it. Without the zoom the row
  // would simply vanish from the outline with no feedback at all.
  await page.goto("/");
  await expect(page.locator(`[data-node-id="${ROOT}"]`)).toHaveCount(0);
});

test("Add field names a new field and gives the node an editable row for it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(`[data-node-id="${PERSPECTIVE}"]`).first()).toBeVisible();

  await runCommand(page, PERSPECTIVE, "Add field");
  // Same picker as add-tag: no match means offer to mint one from what was typed.
  await page.keyboard.type("priority");
  await expect(
    page.getByRole("dialog").getByRole("button", {
      name: 'Create field "priority"',
    }),
  ).toBeVisible();
  await page.keyboard.press("Enter");

  const row = page
    .locator('[data-fields-for] [data-field-row="true"]')
    .filter({ hasText: "priority" })
    .first();
  await expect(row).toBeVisible();

  // Two values, one label. The old shape rendered a whole labelled row per
  // value, so a field with two values said "priority" twice.
  // A text slot only becomes contenteditable once clicked, so click the slot.
  await row.locator("[data-editable-text]").first().click();
  await page.keyboard.type("high");
  // GAP [[01M3A6NB33CT1EMM418HBN8GTT]]: a tx frame confirming an earlier write
  // that is still in flight carries the node without "high". Merging that
  // frame unmounts the row and its "+ value" slot. So the spec waits until the
  // replica has merged the server's state as of the "high" write. The POST
  // response is not enough, because the socket frame can land after it.
  const confirmed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/action") &&
      (response.request().postData() ?? "").includes('"v":"high"'),
  );
  await page.keyboard.press("Enter");
  await confirmed;
  const head = ((await (await page.request.get("/api/graph")).json()) as { rev: number }).rev;
  await expect
    .poll(() => page.evaluate(() => Number(document.documentElement.dataset.kbRev ?? -1)))
    .toBeGreaterThanOrEqual(head);
  await expect(row.locator('[data-field-value="true"]')).toHaveCount(1);
  await expect(row.locator('[data-field-value="true"]')).toHaveText("high");

  await row.getByRole("button", { name: "value", exact: true }).click();
  await row.locator("[data-editable-text]").last().click();
  await page.keyboard.type("later");
  await page.keyboard.press("Enter");

  await expect(row.locator('[data-field-value="true"]')).toHaveCount(2);
  await expect(row.locator("[data-field-values]")).toHaveCount(1);
});

test("global search finds nodes on a freshly loaded store", async ({ page }) => {
  // The harness server has just opened its store and nothing has mutated it, so
  // its rev is 0 — the exact condition under which the palette used to cache an
  // empty index (built before hydration) and never rebuild, leaving ⌘K matching
  // nothing at all until the first edit.
  await page.goto("/");
  await expect(page.locator(`[data-node-id="${PERSPECTIVE}"]`).first()).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Search and open" });
  await expect(search).toBeVisible();
  await page.keyboard.type("Fixture");

  await expect(search).not.toContainText("No matches");
  await expect(search.getByRole("button", { name: /Fixture/ }).first()).toBeVisible();
});
