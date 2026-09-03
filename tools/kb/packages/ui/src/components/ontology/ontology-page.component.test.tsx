/**
 * Store-coupled ontology page render. Needs a real DOM: zustand hooks resolve
 * their INITIAL state inside React's server renderer, so anything reading the
 * store is covered here rather than through react-dom/server.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { OntologyPage } from "./ontology-page";

const ISO = "2026-08-23T00:00:00.000Z";

function node(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return { id, text, props, children: [], createdAt: ISO, updatedAt: ISO };
}

const TAG = "t.svc";

function wire(): WireNode[] {
  return [
    node(TAG, "service", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    }),
    node("n.a", "tailscaled", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: TAG }],
    }),
    node("n.p", "cloudflare tunnel notes"),
    node("n.x", "old vpn doc"),
    node("o.parent", "Networking", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
    }),
    node("o.1", "Infrastructure", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
      [SYSTEM_IDS.ontoIncludeField]: [{ t: "ref", v: TAG }],
      [SYSTEM_IDS.ontoMemberField]: [{ t: "ref", v: "n.p" }],
      [SYSTEM_IDS.ontoExcludeField]: [{ t: "ref", v: "n.x" }],
      [SYSTEM_IDS.ontoExtendsField]: [{ t: "ref", v: "o.parent" }],
    }),
  ];
}

describe("OntologyPage (component)", () => {
  let dom: Window;
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new Window();
    const g = globalThis as Record<string, unknown>;
    g.window = dom;
    g.document = dom.document;
    g.HTMLElement = dom.HTMLElement;
    g.KeyboardEvent = dom.KeyboardEvent;
    g.MouseEvent = dom.MouseEvent;
    g.PointerEvent = dom.MouseEvent;
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
  });

  beforeEach(() => {
    useOutlineStore.getState().hydrateFromWire(wire(), 3, "fixtures");
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(id: string): Promise<string> {
    await act(async () => {
      root.render(<OntologyPage ontologyId={id} />);
    });
    return container.innerHTML;
  }

  it("renders a provenance label per member row", async () => {
    const html = await render("o.1");
    expect(html).toContain("tailscaled");
    expect(html).toContain("via #service");
    expect(html).toContain("cloudflare tunnel notes");
    expect(html).toContain("pinned");
  });

  it("offers inline rename of the ontology itself", async () => {
    await render("o.1");
    const input = container.querySelector(
      'input[aria-label="Ontology name"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.value).toBe("Infrastructure");
  });

  it("renders include and extends chips from the definition props", async () => {
    const html = await render("o.1");
    expect(html).toContain("include");
    expect(html).toContain("#service");
    expect(html).toContain("extends");
    expect(html).toContain("Networking");
    expect(html).toContain("closure");
  });

  it("renders excluded rows with a restore affordance", async () => {
    const html = await render("o.1");
    expect(html).toContain("Excluded");
    expect(html).toContain("old vpn doc");
    expect(html).toContain("Restore old vpn doc");
    expect(html).toContain("keep their tags");
  });

  it("teaches the empty state instead of rendering a blank page", async () => {
    const html = await render("o.parent");
    expect(html).toContain("Nothing here yet");
    expect(html).toContain("no tags yet");
  });

  it("degrades to a named not-found state for an unknown id", async () => {
    const html = await render("o.nope");
    expect(html).toContain("Ontology not found");
    expect(html).toContain("o.nope");
  });

  it("surfaces resolution warnings on the page", async () => {
    useOutlineStore.getState().hydrateFromWire(
      [
        ...wire(),
        node("o.bad", "Broken", {
          [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
          [SYSTEM_IDS.ontoQueryField]: [{ t: "str", v: "[:find ?id :where" }],
        }),
      ],
      4,
      "fixtures",
    );
    const html = await render("o.bad");
    expect(html).toContain('data-ontology-page-warnings="true"');
    expect(html).toContain("onto.query failed");
  });
});
