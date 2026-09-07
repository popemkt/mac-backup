import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { CanvasDoc } from "@kb/canvas";
import { EMPTY_SELECTION, selectNode, type CanvasSelection } from "@/lib/canvas-selection";
import type { ToolState } from "@/lib/canvas-tool";
import { useCanvasKeyboard } from "./use-canvas-keyboard";

/**
 * The canvas keydown table, recorded through the hook (gap
 * 01M1MGCS6A29HT51G40W5TEEYK).
 *
 * Every assertion here is the behaviour of the 66-branch effect this wave
 * replaces with a pure chord map plus an applier, so it must pass unchanged
 * across that move. It drives `window` keydown events and records the context
 * callbacks each chord reaches, in order — including the two quirks a naive
 * rewrite loses: `Escape` does not preventDefault, and an arrow key with an
 * empty selection is swallowed *without* preventDefault while Delete, copy
 * and duplicate are swallowed *with* it.
 */

const doc: CanvasDoc = {
  nodes: [
    { id: "a", type: "shape", shape: "rect", x: 0, y: 0, width: 160, height: 100 },
    { id: "b", type: "shape", shape: "rect", x: 300, y: 200, width: 160, height: 100 },
  ],
  edges: [
    {
      id: "e1",
      fromNode: "a",
      toNode: "b",
      fromSide: "right",
      toSide: "left",
      toEnd: "arrow",
    },
  ],
};

interface Chord {
  key: string;
  code?: string;
  metaKey?: boolean;
  shiftKey?: boolean;
  onInput?: boolean;
}

interface Recording {
  log: string[];
  docs: CanvasDoc[];
  defaultPrevented: boolean;
}

/** Selection as a stable label: ids the fixture did not name are freshly minted. */
function ids(selection: CanvasSelection): string {
  const known = new Set(["a", "b", "e1"]);
  return (
    [...selection.nodeIds, ...selection.edgeIds]
      .map((id) => (known.has(id) ? id : "<new>"))
      .toSorted()
      .join("+") || "none"
  );
}

let dom: Window;
let root: Root;
let container: HTMLElement;
let clipboard: { text: string; reads: number; writes: string[] };

beforeAll(() => {
  dom = new Window({ url: "https://kb.test/" });
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    Node: dom.Node,
    KeyboardEvent: dom.KeyboardEvent,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: clearTimeout,
  });
  // `navigator` is getter-only on globalThis; the clipboard the handler reads
  // is the one on the installed window.
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        clipboard.writes.push(text);
      },
      readText: async () => {
        clipboard.reads += 1;
        return clipboard.text;
      },
    },
  });
});

beforeEach(() => {
  clipboard = { text: "", reads: 0, writes: [] };
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Mount the hook over a recording context and press one chord. */
function press(chord: Chord, selection: CanvasSelection = selectNode("a")): Recording {
  const log: string[] = [];
  const docs: CanvasDoc[] = [];
  const docRef = { current: doc };
  const selRef = { current: selection };
  let toolState: ToolState = { tool: "select" };
  let zoom = 1;
  const context = {
    cancelPointer: () => log.push("cancelPointer"),
    byId: new Map(doc.nodes.map((node) => [node.id, node])),
    docRef,
    selRef,
    schedulePersist: (next: CanvasDoc) => {
      docs.push(next);
      docRef.current = next;
      log.push("persist");
    },
    undoCanvasDoc: () => log.push("undo"),
    redoCanvasDoc: () => log.push("redo"),
    zoomToFit: () => log.push("zoomToFit"),
    setSelection: (next: CanvasSelection | ((s: CanvasSelection) => CanvasSelection)) => {
      selRef.current = typeof next === "function" ? next(selRef.current) : next;
      log.push(`selection=${ids(selRef.current)}`);
    },
    setInspectorAnchor: () => log.push("anchor=null"),
    setShapeInspectorAnchor: () => log.push("shapeAnchor=null"),
    setPickerOpen: () => log.push("picker=true"),
    setSpaceDown: () => log.push("space=true"),
    setToolState: (next: ToolState | ((s: ToolState) => ToolState)) => {
      toolState = typeof next === "function" ? next(toolState) : next;
      log.push(`tool=${toolState.tool}`);
    },
    setZoom: (next: number | ((z: number) => number)) => {
      zoom = typeof next === "function" ? next(zoom) : next;
      log.push(`zoom=${Math.round(zoom * 1000) / 1000}`);
    },
  };

  function Probe() {
    useCanvasKeyboard(context);
    return null;
  }
  root = createRoot(container);
  act(() => root.render(<Probe />));

  const target: EventTarget = chord.onInput === true ? document.createElement("input") : window;
  if (target instanceof HTMLElement) document.body.appendChild(target);
  const event = new dom.KeyboardEvent("keydown", {
    key: chord.key,
    code: chord.code ?? "",
    metaKey: chord.metaKey ?? false,
    shiftKey: chord.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event as unknown as Event);
  });
  return { log, docs, defaultPrevented: event.defaultPrevented };
}

describe("the canvas keydown table", () => {
  const table: [name: string, chord: Chord, effects: string[]][] = [
    ["undo", { key: "z", metaKey: true }, ["cancelPointer", "undo"]],
    ["redo (shift)", { key: "z", metaKey: true, shiftKey: true }, ["cancelPointer", "redo"]],
    ["redo (Z)", { key: "Z", metaKey: true }, ["cancelPointer", "redo"]],
    ["redo (y)", { key: "y", metaKey: true }, ["cancelPointer", "redo"]],
    ["delete", { key: "Delete" }, ["persist", "selection=none", "anchor=null", "shapeAnchor=null"]],
    [
      "backspace",
      { key: "Backspace" },
      ["persist", "selection=none", "anchor=null", "shapeAnchor=null"],
    ],
    ["select all", { key: "a", metaKey: true }, ["selection=a+b+e1"]],
    ["duplicate", { key: "d", metaKey: true }, ["persist", "selection=<new>"]],
    [
      "escape",
      { key: "Escape" },
      ["cancelPointer", "tool=select", "selection=none", "anchor=null", "shapeAnchor=null"],
    ],
    ["space", { key: " ", code: "Space" }, ["space=true"]],
    ["nudge left", { key: "ArrowLeft" }, ["persist"]],
    ["nudge right (shift)", { key: "ArrowRight", shiftKey: true }, ["persist"]],
    ["tool select (v)", { key: "v" }, ["tool=select"]],
    ["tool select (1)", { key: "1" }, ["tool=select"]],
    ["tool text (t)", { key: "t" }, ["tool=text"]],
    ["tool rect (r)", { key: "r" }, ["tool=rect"]],
    ["tool ellipse (o)", { key: "o" }, ["tool=ellipse"]],
    ["tool ellipse (c)", { key: "c" }, ["tool=ellipse"]],
    ["tool diamond (d)", { key: "d" }, ["tool=diamond"]],
    ["tool group (g)", { key: "g" }, ["tool=group"]],
    ["kb-node picker (n)", { key: "n" }, ["tool=select", "picker=true"]],
    ["zoom in", { key: "=", metaKey: true }, ["zoom=1.15"]],
    ["zoom in (+)", { key: "+", metaKey: true }, ["zoom=1.15"]],
    ["zoom out", { key: "-", metaKey: true }, ["zoom=0.87"]],
    ["zoom reset", { key: "0", metaKey: true }, ["zoom=1"]],
    ["zoom to fit", { key: "!", shiftKey: true }, ["zoomToFit"]],
    ["unbound key", { key: "q", metaKey: true }, []],
    ["inside a text entry", { key: "Delete", onInput: true }, []],
  ];

  test.each(table)("%s", (_name, chord, effects) => {
    expect(press(chord).log).toEqual(effects);
  });

  const prevented: [name: string, chord: Chord, defaultPrevented: boolean][] = [
    ["undo", { key: "z", metaKey: true }, true],
    ["delete", { key: "Delete" }, true],
    ["select all", { key: "a", metaKey: true }, true],
    ["duplicate", { key: "d", metaKey: true }, true],
    ["space", { key: " ", code: "Space" }, true],
    ["nudge", { key: "ArrowLeft" }, true],
    ["tool", { key: "r" }, true],
    ["zoom in", { key: "=", metaKey: true }, true],
    ["zoom to fit", { key: "!", shiftKey: true }, true],
    // Escape stays un-prevented so it can also close a native surface.
    ["escape", { key: "Escape" }, false],
    ["unbound key", { key: "q", metaKey: true }, false],
    ["inside a text entry", { key: "Delete", onInput: true }, false],
  ];

  test.each(prevented)("%s prevents the default: %o", (_name, chord, expected) => {
    expect(press(chord).defaultPrevented).toBe(expected);
  });
});

describe("an empty selection", () => {
  const swallowed: [name: string, chord: Chord, defaultPrevented: boolean][] = [
    ["delete", { key: "Delete" }, true],
    ["copy", { key: "c", metaKey: true }, true],
    ["duplicate", { key: "d", metaKey: true }, true],
    // The only chord the handler swallows without preventing the default.
    ["nudge", { key: "ArrowLeft" }, false],
  ];

  test.each(swallowed)("%s does nothing (prevented: %o)", (_name, chord, expected) => {
    const recording = press(chord, EMPTY_SELECTION);
    expect(recording.log).toEqual([]);
    expect(recording.defaultPrevented).toBe(expected);
  });
});

describe("clipboard", () => {
  test("copy writes the selected nodes and their internal edges", () => {
    press({ key: "c", metaKey: true }, { nodeIds: new Set(["a", "b"]), edgeIds: new Set() });
    expect(clipboard.writes).toHaveLength(1);
    const copied = JSON.parse(clipboard.writes[0] ?? "{}") as CanvasDoc;
    expect(copied.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(copied.edges.map((edge) => edge.id)).toEqual(["e1"]);
  });

  test("copy of one endpoint leaves the edge behind", () => {
    press({ key: "c", metaKey: true });
    const copied = JSON.parse(clipboard.writes[0] ?? "{}") as CanvasDoc;
    expect(copied.nodes.map((node) => node.id)).toEqual(["a"]);
    expect(copied.edges).toEqual([]);
  });

  test("paste remaps ids, offsets by 24 and selects what it pasted", async () => {
    clipboard.text = JSON.stringify({
      nodes: [{ id: "a", type: "shape", shape: "rect", x: 10, y: 20, width: 160, height: 100 }],
      edges: [],
    });
    const recording = press({ key: "v", metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(clipboard.reads).toBe(1);
    const pasted = recording.docs.at(-1);
    expect(pasted?.nodes).toHaveLength(3);
    const added = pasted?.nodes.at(-1);
    expect(added?.id).not.toBe("a");
    expect(added?.x).toBe(34);
    expect(added?.y).toBe(44);
    expect(recording.log).toEqual(["persist", "selection=<new>"]);
  });

  test("paste of a non-canvas payload changes nothing", async () => {
    clipboard.text = "not a canvas";
    const recording = press({ key: "v", metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(recording.log).toEqual([]);
    expect(recording.docs).toEqual([]);
  });
});

describe("the applied mutations", () => {
  test("delete cascades to incident edges", () => {
    const recording = press({ key: "Delete" });
    expect(recording.docs[0]?.nodes.map((node) => node.id)).toEqual(["b"]);
    expect(recording.docs[0]?.edges).toEqual([]);
  });

  test("an unshifted arrow moves by one, a shifted arrow by ten", () => {
    expect(press({ key: "ArrowLeft" }).docs[0]?.nodes[0]?.x).toBe(-1);
    expect(press({ key: "ArrowUp", shiftKey: true }).docs[0]?.nodes[0]?.y).toBe(-10);
    expect(press({ key: "ArrowRight" }).docs[0]?.nodes[0]?.x).toBe(1);
    expect(press({ key: "ArrowDown", shiftKey: true }).docs[0]?.nodes[0]?.y).toBe(10);
  });

  test("duplicate offsets the copy by 24 and keeps the original", () => {
    const recording = press({ key: "d", metaKey: true });
    const nodes = recording.docs[0]?.nodes ?? [];
    expect(nodes).toHaveLength(3);
    expect(nodes.at(-1)?.x).toBe(24);
    expect(nodes.at(-1)?.y).toBe(24);
    expect(nodes.at(-1)?.id).not.toBe("a");
  });

  test("duplicating both endpoints rewires the copied edge to the copies", () => {
    const recording = press(
      { key: "d", metaKey: true },
      { nodeIds: new Set(["a", "b"]), edgeIds: new Set() },
    );
    const next = recording.docs[0];
    const copiedEdge = next?.edges.find((edge) => edge.id !== "e1");
    expect(copiedEdge?.fromNode).not.toBe("a");
    expect(copiedEdge?.toNode).not.toBe("b");
    expect(next?.nodes.some((node) => node.id === copiedEdge?.fromNode)).toBe(true);
    expect(next?.nodes.some((node) => node.id === copiedEdge?.toNode)).toBe(true);
  });
});
