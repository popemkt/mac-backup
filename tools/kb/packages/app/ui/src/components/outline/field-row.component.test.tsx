/**
 * A field's glyph is the field's own button: the field is a node, its page is
 * where it is configured, so clicking the glyph follows the field the way a
 * bullet follows a node — a plain click opens it, ⌘/Ctrl-click reveals it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import type { FollowHow, FollowTarget } from "@kb/ui-sdk";
import { FieldRow } from "./field-row";
import { TagFieldsConfigView } from "./tag-fields-config";

describe("a field row's glyph", () => {
  let dom: InstalledDom;
  let container: HTMLDivElement;
  let root: Root;
  let followed: Array<[FollowTarget, FollowHow]>;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.restore();
  });

  beforeEach(() => {
    followed = [];
    container = dom.window.document.createElement("div") as unknown as HTMLDivElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderRow() {
    await act(async () => {
      root.render(
        createElement(FieldRow, {
          fieldId: "f.status",
          label: "status",
          onFollow: (target, how) => followed.push([target, how]),
          children: createElement("span", null, "todo"),
        }),
      );
    });
    return present(
      container.querySelector<HTMLButtonElement>('[data-field-configure="f.status"]'),
      "configure button",
    );
  }

  it("is a labelled, focusable icon button", async () => {
    const button = await renderRow();
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("Configure field status");
    expect(button.getAttribute("title")).toBe("Configure field status");
    expect(button.getAttribute("tabindex")).toBeNull();
    expect(button.getAttribute("data-icon-button")).toBe("md");
  });

  it("opens the field on a plain click and reveals it on a modifier click", async () => {
    const button = await renderRow();
    await act(async () => button.click());
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    });
    expect(followed).toEqual([
      [{ kind: "node", id: "f.status" }, "open"],
      [{ kind: "node", id: "f.status" }, "reveal"],
    ]);
  });

  it("is inert where the row stands for no field node", () => {
    // A preference row has a glyph and a label, but no field to open.
    const html = renderToStaticMarkup(
      createElement(FieldRow, { label: "Theme", children: createElement("span", null, "kb") }),
    );
    expect(html).not.toContain("<button");
    expect(html).not.toContain("data-field-configure");
  });

  it("is the way a tag's field template opens a field", () => {
    const html = renderToStaticMarkup(
      createElement(TagFieldsConfigView, {
        template: [{ id: "f_owner", name: "owner" }],
        suggestions: [],
        readOnly: false,
        onAdd: () => undefined,
        onRemove: () => undefined,
        onFollow: () => undefined,
      }),
    );
    expect(html).toContain('aria-label="Configure field owner"');
    // The old "open" link was a second gesture for the same follow.
    expect(html).not.toMatch(/>open</);
  });
});
