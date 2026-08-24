// Deliberately .e2e.ts: Bun's recursive unit-test discovery must not load it.
//
// These drive the real palette against a real store. The lesson from i13's
// dead graph toolbar is that a command can render, read correctly, and pass
// every unit assertion while its effect never lands — so the only assertion
// worth making about a new gesture is that invoking it changed the document.
import { expect, test, type Page } from "playwright/test";
import { startHarness } from "./harness-server.ts";

// The fixture leaves sit collapsed under this root, so these two are the rows
// reliably on screen at "/". They are deliberately different nodes: the store
// persists across tests in a run, and promoting a node removes it from the
// outline forest.
const ROOT = "render.fixture.root";
const PERSPECTIVE = "lens.all-mentions";

/**
 * These specs write, so they get their own store. Sharing the default one made
 * the graph specs — which count fixture nodes — fail because a node promoted
 * here is no longer in the forest there.
 */
let harness: { url: string; stop: () => Promise<void> };

test.beforeAll(async () => {
  harness = await startHarness(4324);
});

test.afterAll(async () => {
  await harness.stop();
});

const home = () => `${harness.url}/`;

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

test("Make supertag promotes the node and takes the user to its schema", async ({
  page,
}) => {
  await page.goto(home());
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
  await page.goto(home());
  await expect(page.locator(`[data-node-id="${ROOT}"]`)).toHaveCount(0);
});

test("Add field names a new field and gives the node an editable row for it", async ({
  page,
}) => {
  await page.goto(home());
  await expect(
    page.locator(`[data-node-id="${PERSPECTIVE}"]`).first(),
  ).toBeVisible();

  await runCommand(page, PERSPECTIVE, "Add field");
  // Same picker as add-tag: no match means offer to mint one from what was typed.
  await page.keyboard.type("priority");
  await expect(
    page.getByRole("dialog").getByRole("button", {
      name: 'Create field "priority"',
    }),
  ).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(
    page
      .locator('[data-fields-for] [data-field-row="true"]')
      .filter({ hasText: "priority" })
      .first(),
  ).toBeVisible();
});
