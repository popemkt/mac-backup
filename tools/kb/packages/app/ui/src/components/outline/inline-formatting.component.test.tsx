/**
 * Node text keeps its formatting while it is edited.
 *
 * A row's text is one inline tree (`renderInlineMarkdown` / `InlineMarkdown`)
 * whether it is read or edited: entering edit mode turns the same tree
 * editable instead of swapping it for raw source, only the markup of the
 * segment under the caret shows, and typing that opens or closes a segment
 * re-forms the tree around the caret.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { present } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { fixtureGraph } from "@/api/fixture-graph";
import { outlineInstanceKey } from "@/lib/instance-key";
import { isTextNode } from "@/lib/dom";
import { getCaretSerializedOffset, setCaretSerializedOffset } from "@/lib/md-edit";
import { useOutlineStore } from "@/stores/outline.store";
import { resetOutlineStore } from "@/test-support/outline-store";
import { NodeBlock } from "./node-block";

const ISO = "2026-09-27T05:00:00.000Z";
const TEXT = "plain **bold** *it* `code` [docs](https://ex.test) [[n.root-a|Ship]]";

function wire(id: string, text: string): WireNode {
  return { id, text, props: {}, children: [], createdAt: ISO, updatedAt: ISO };
}

function click(el: Element) {
  const Ctor = (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
  el.dispatchEvent(new Ctor("click", { bubbles: true, cancelable: true }));
}

const withoutReveal = (html: string) => html.replaceAll(' data-md-reveal=""', "");

describe("inline formatting while editing", () => {
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
    g.Node = dom.Node;
    g.CSS = { escape: (s: string) => s };
  });

  beforeEach(() => {
    resetOutlineStore();
    useOutlineStore
      .getState()
      .hydrateFromWire(
        [...fixtureGraph.nodes, wire("n.fmt", TEXT), wire("n.typed", "x **y*")],
        fixtureGraph.rev,
        "fixtures",
      );
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(nodeId: string) {
    const key = outlineInstanceKey(nodeId, useOutlineStore.getState().nodes);
    await act(async () => {
      root.render(<NodeBlock nodeId={nodeId} instanceKey={key} depth={0} />);
    });
    return key;
  }

  const view = (key: string) =>
    present(container.querySelector(`[data-instance-key="${key}"] .kb-md-view`), "text");
  const editor = (key: string) =>
    present(
      container.querySelector<HTMLElement>(`[data-instance-key="${key}"] [contenteditable="true"]`),
      "editor",
    );

  async function activate(nodeId: string, key: string, at: number) {
    await act(async () => {
      useOutlineStore.getState().activateNode(nodeId, at, key);
    });
    await render(nodeId);
  }

  it("reads formatted, with the markup present and hidden", async () => {
    const key = await render("n.fmt");
    const text = view(key);
    expect(text.getAttribute("contenteditable")).toBeNull();
    expect(text.querySelector("strong")?.textContent).toBe("bold");
    expect(text.querySelector("em")?.textContent).toBe("it");
    expect(text.querySelector("code.kb-md-code")?.textContent).toBe("code");
    expect(text.querySelector("a.kb-md-link")?.textContent).toBe("docs");
    expect(text.querySelector("a.kb-md-ref")?.textContent).toBe("Ship");
    expect(text.querySelectorAll(".kb-md-seg[data-md-reveal]").length).toBe(0);
  });

  it("enters edit mode on the same tree, so nothing moves", async () => {
    const key = await render("n.fmt");
    const before = view(key).innerHTML;
    await activate("n.fmt", key, 0);
    const edit = editor(key);
    expect(withoutReveal(edit.innerHTML)).toBe(before);
    expect(edit.querySelector("strong")?.textContent).toBe("bold");
    expect(edit.querySelector("[data-kb-ref]")?.getAttribute("contenteditable")).toBe("false");
  });

  it("puts the caret at the offset asked for and reveals only that segment's markup", async () => {
    const key = await render("n.fmt");
    // Inside "bold": after "plain **bo".
    await activate("n.fmt", key, 10);
    const edit = editor(key);
    expect(getCaretSerializedOffset(edit)).toBe(10);
    const shown = [...edit.querySelectorAll(".kb-md-seg[data-md-reveal]")];
    expect(shown.map((s) => s.textContent)).toEqual(["**bold**"]);
  });

  it("moves the reveal with the caret", async () => {
    const key = await render("n.fmt");
    await activate("n.fmt", key, 10);
    const edit = editor(key);
    await act(async () => {
      // `code`'s opening backtick sits at 20.
      setCaretSerializedOffset(edit, 21);
      dom.document.dispatchEvent(new dom.Event("selectionchange"));
    });
    const shown = [...edit.querySelectorAll(".kb-md-seg[data-md-reveal]")];
    expect(shown.map((s) => s.textContent)).toEqual(["`code`"]);
  });

  it("re-forms the tree when typing closes a segment, keeping the caret", async () => {
    const key = await render("n.typed");
    await activate("n.typed", key, 6);
    const edit = editor(key);
    expect(edit.querySelector("strong")).toBeNull();
    await act(async () => {
      // The browser types the second `*` into the text node the caret is in.
      const tail = present(edit.lastChild, "tail");
      if (isTextNode(tail)) tail.data += "*";
      setCaretSerializedOffset(edit, 7);
      edit.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
    });
    expect(useOutlineStore.getState().nodes.get("n.typed")?.text).toBe("x **y**");
    expect(edit.querySelector("strong")?.textContent).toBe("y");
    expect(getCaretSerializedOffset(edit)).toBe(7);
  });

  it("undoes typing across a rebuild, which native undo cannot follow", async () => {
    const key = await render("n.typed");
    await activate("n.typed", key, 6);
    const edit = editor(key);
    await act(async () => {
      const tail = present(edit.lastChild, "tail");
      if (isTextNode(tail)) tail.data += "*";
      setCaretSerializedOffset(edit, 7);
      edit.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
    });
    await render("n.typed");
    expect(edit.querySelector("strong")).not.toBeNull();
    const chord = (shiftKey: boolean) =>
      new dom.KeyboardEvent("keydown", {
        key: "z",
        metaKey: true,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }) as unknown as Event;
    await act(async () => {
      edit.dispatchEvent(chord(false));
    });
    expect(useOutlineStore.getState().nodes.get("n.typed")?.text).toBe("x **y*");
    expect(edit.querySelector("strong")).toBeNull();
    expect(getCaretSerializedOffset(edit)).toBe(6);
    await act(async () => {
      edit.dispatchEvent(chord(true));
    });
    expect(useOutlineStore.getState().nodes.get("n.typed")?.text).toBe("x **y**");
    expect(edit.querySelector("strong")?.textContent).toBe("y");
  });

  it("leaves the browser's DOM alone for typing inside a segment", async () => {
    const key = await render("n.fmt");
    await activate("n.fmt", key, 10);
    const edit = editor(key);
    const boldText = present(edit.querySelector("strong")?.firstChild, "bold text");
    await act(async () => {
      if (isTextNode(boldText)) boldText.data = "bolder";
      edit.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
    });
    expect(useOutlineStore.getState().nodes.get("n.fmt")?.text).toContain("**bolder**");
    // Same node: not rebuilt, so native editing state survives.
    expect(edit.querySelector("strong")?.firstChild).toBe(boldText);
  });

  it("a reference clicked while editing navigates, like one clicked while reading", async () => {
    const key = await render("n.fmt");
    await activate("n.fmt", key, 0);
    const ref = present(editor(key).querySelector("a.kb-md-ref"), "ref");
    await act(async () => click(ref));
    expect(useOutlineStore.getState().rootNodeId).toBe("n.root-a");
  });
});
