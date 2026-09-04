/**
 * Bullet paint, and what a reference row's bullet does when you click it.
 *
 * Two owner-reported defects live here:
 *
 *  - **A node's tag colors are a list, not a scalar.** Every call site used to
 *    reduce them with `tags[0]?.color`, so a node carrying three tags painted
 *    one. Tana divides the bullet equally from the center instead; the filled
 *    surfaces now carry every tag color as equal conic wedges, and the one-tag
 *    and zero-tag renders are pinned below so the common case cannot drift.
 *
 *  - **A reference row's bullet must behave like any other row's.** Plain click
 *    toggles, modifier click focuses. It used to force a zoom, which made a
 *    query result impossible to expand in place.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import { stubOutlineNode } from "@/catalog/fixtures";
import { fixtureGraph } from "@/fixtures/graph";
import { queryResultInstanceKey } from "@/lib/instance-key";
import { SYSTEM_IDS, WORKSPACE_ROOT_ID, type OutlineNode, type TagBadge } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { Bullet } from "./bullet";
import { NodeBlock } from "./node-block";

const RED = "#ef4444";
const GREEN = "#22c55e";
const BLUE = "#3b82f6";

function tag(id: string, color: string): TagBadge {
  return { id, name: id, color };
}

function bulletHtml(node: OutlineNode, isRef = false): string {
  return renderToStaticMarkup(createElement(Bullet, { node, isRef, onClick: () => undefined }));
}

describe("bullet paint (a node's tag colors)", () => {
  it("divides the filled surfaces into equal wedges for three tags", () => {
    const node = stubOutlineNode({
      id: "n.multi",
      text: "Three supertags",
      tags: [tag("t.a", RED), tag("t.b", GREEN), tag("t.c", BLUE)],
    });

    const html = bulletHtml(node);
    // The dot is the surface that always carries the color.
    expect(html).toContain(
      `background:conic-gradient(from 0deg, ${RED} 0% 33.333%,` +
        ` ${GREEN} 33.333% 66.667%, ${BLUE} 66.667% 100%)`,
    );
    // Every tag color reaches the bullet — not just the first.
    for (const color of [RED, GREEN, BLUE]) expect(html).toContain(color);
  });

  it("divides the collapsed halo too, at the halo's own tint", () => {
    const node = stubOutlineNode({
      id: "n.multi",
      text: "Three supertags",
      children: ["c1", "c2"],
      collapsed: true,
      tags: [tag("t.a", RED), tag("t.b", GREEN), tag("t.c", BLUE)],
    });

    const html = bulletHtml(node);
    expect(html).toContain("data-bullet-halo");
    expect(html).toContain(
      "background:conic-gradient(from 0deg," +
        ` color-mix(in oklab, ${RED} 12.5%, transparent) 0% 33.333%,` +
        ` color-mix(in oklab, ${GREEN} 12.5%, transparent) 33.333% 66.667%,` +
        ` color-mix(in oklab, ${BLUE} 12.5%, transparent) 66.667% 100%)`,
    );
  });

  it("a reference row's dot divides inside the dashed ring", () => {
    const node = stubOutlineNode({
      id: "n.multi",
      text: "Three supertags",
      tags: [tag("t.a", RED), tag("t.b", GREEN), tag("t.c", BLUE)],
    });

    const html = bulletHtml(node, true);
    expect(html).toContain("data-bullet-ref-ring");
    expect(html).toContain("conic-gradient");
    for (const color of [RED, GREEN, BLUE]) expect(html).toContain(color);
  });

  it("two tags that resolve to one color stay a single solid fill", () => {
    const node = stubOutlineNode({
      id: "n.dup",
      text: "Same color twice",
      tags: [tag("t.a", RED), tag("t.b", RED)],
    });

    expect(bulletHtml(node)).not.toContain("conic-gradient");
  });

  // --- the common cases, pinned unchanged -------------------------------

  it("one tag paints exactly the solid color it always has", () => {
    const html = bulletHtml(
      stubOutlineNode({
        id: "n.one",
        text: "One supertag",
        tags: [tag("t.a", RED)],
      }),
    );
    expect(html).not.toContain("conic-gradient");
    expect(html).toContain(`background:${RED}`);
    expect(html).not.toContain("bg-foreground/40");
  });

  it("one tag still tints the collapsed halo at 12.5%, nothing more", () => {
    const html = bulletHtml(
      stubOutlineNode({
        id: "n.one",
        text: "One supertag",
        children: ["c1"],
        collapsed: true,
        tags: [tag("t.a", RED)],
      }),
    );
    expect(html).not.toContain("conic-gradient");
    expect(html).toContain(`color-mix(in oklab, ${RED} 12.5%, transparent)`);
  });

  it("no tags keeps the foreground fallback and paints nothing inline", () => {
    const html = bulletHtml(stubOutlineNode({ id: "n.bare", text: "Bare" }));
    expect(html).toContain("bg-foreground/40");
    expect(html).not.toContain("conic-gradient");
    expect(html).not.toMatch(/style="[^"]*background/);
    expect(html).not.toMatch(/style="[^"]*color-mix/);
  });

  // --- the hex-alpha assumption ----------------------------------------

  it("tints a named tag color instead of concatenating hex digits", () => {
    // resolveTagColor returns an explicit sys.f.color prop verbatim, so the
    // value reaching the bullet need not be a 6-digit hex. `"red" + "20"` is
    // not a color.
    const html = bulletHtml(
      stubOutlineNode({
        id: "n.named",
        text: "Named color",
        children: ["c1"],
        collapsed: true,
        tags: [tag("t.a", "red")],
      }),
    );
    expect(html).toContain("data-bullet-halo");
    expect(html).not.toContain("red20");
    expect(html).toContain("color-mix(in oklab, red 12.5%, transparent)");
  });

  it("tints the dashed ref ring stroke the same way", () => {
    const html = bulletHtml(
      stubOutlineNode({
        id: "n.named",
        text: "Named color",
        tags: [tag("t.a", "red")],
      }),
      true,
    );
    expect(html).toContain("data-bullet-ref-ring");
    expect(html).not.toContain("red40");
    expect(html).toContain("border-color:color-mix(in oklab, red 25%, transparent)");
  });

  // --- surfaces that cannot be divided ----------------------------------

  it("a glyph bullet takes the first tag color — a # cannot be a pie", () => {
    const html = bulletHtml(
      stubOutlineNode({
        id: "tag.x",
        text: "x",
        props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }] },
        tags: [tag("t.a", RED), tag("t.b", GREEN)],
      }),
    );
    expect(html).toContain('data-bullet-kind="tag"');
    expect(html).toContain(`color:${RED}`);
    expect(html).not.toContain("conic-gradient");
  });
});

function seedRefRow() {
  useOutlineStore.setState({
    nodes: new Map(),
    wireNodes: [],
    queryDb: null,
    rev: 0,
    rootNodeId: WORKSPACE_ROOT_ID,
    homeRootId: WORKSPACE_ROOT_ID,
    activeNodeId: null,
    activeInstanceKey: null,
    selectedNodeId: null,
    selectedInstanceKey: null,
    loadSource: null,
    loadError: null,
  });
  useOutlineStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
}

describe("reference-row bullet click parity", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  const refKey = queryResultInstanceKey("n.q1", "n.root-a");

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
  });

  beforeEach(() => {
    seedRefRow();
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderRefRow(): Promise<HTMLElement> {
    await act(async () => {
      root.render(<NodeBlock nodeId="n.root-a" instanceKey={refKey} depth={1} isRef />);
    });
    const bullet = container.querySelector(
      `[data-instance-key="${refKey}"] [data-bullet-ref="true"]`,
    ) as HTMLElement | null;
    return present(bullet, "ref bullet");
  }

  function clickBullet(bullet: HTMLElement, modifier = false): void {
    act(() => {
      bullet.dispatchEvent(
        new dom.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          metaKey: modifier,
        }) as unknown as Event,
      );
    });
  }

  it("promises a toggle on a collapsible reference row", async () => {
    const bullet = await renderRefRow();
    expect(bullet.getAttribute("title")).toBe("Click to toggle, Cmd+click to focus");
  });

  it("a plain click expands the reference row in place, never zooms", async () => {
    // n.root-a has children and hydrates collapsed.
    expect(present(useOutlineStore.getState().nodes.get("n.root-a"), "n.root-a").collapsed).toBe(
      true,
    );
    const bullet = await renderRefRow();

    clickBullet(bullet);

    const s = useOutlineStore.getState();
    expect(present(s.nodes.get("n.root-a"), "n.root-a").collapsed).toBe(false);
    expect(s.rootNodeId).toBe(WORKSPACE_ROOT_ID);
  });

  it("a modifier click focuses the reference target without toggling", async () => {
    const bullet = await renderRefRow();

    clickBullet(bullet, true);

    const s = useOutlineStore.getState();
    expect(s.rootNodeId).toBe("n.root-a");
    expect(present(s.nodes.get("n.root-a"), "n.root-a").collapsed).toBe(true);
  });
});
