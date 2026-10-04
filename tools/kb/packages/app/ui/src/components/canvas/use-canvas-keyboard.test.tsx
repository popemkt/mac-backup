import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { CanvasDoc } from "@kb/canvas";
import { EMPTY_SELECTION, selectNode, type CanvasSelection } from "./canvas-selection";
import type { ToolState } from "./canvas-tool";
import type { CanvasIntent } from "./canvas-keymap";
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
  ctrlKey?: boolean;
  shiftKey?: boolean;
  onInput?: boolean;
  repeat?: boolean;
}

interface Recording {
  log: string[];
  docs: CanvasDoc[];
  defaultPrevented: boolean;
  /** The hook's applier, as the view menu calls it. */
  apply: (intent: CanvasIntent) => void;
}

/** What else the page tells the hook: present mode, the group entered, the document. */
interface Surroundings {
  presenting?: boolean;
  scope?: string | null;
  toolArmed?: boolean;
  doc?: CanvasDoc;
}

/** A frame holding a and b, with a loose c and an edge from a to c. */
const framed: CanvasDoc = {
  nodes: [
    { id: "f", type: "group", label: "F", x: -20, y: -20, width: 500, height: 340 },
    { id: "a", type: "text", text: "a", x: 0, y: 0, width: 80, height: 40, parent: "f" },
    { id: "b", type: "text", text: "b", x: 300, y: 200, width: 80, height: 40, parent: "f" },
    { id: "c", type: "text", text: "c", x: 900, y: 0, width: 80, height: 40 },
  ],
  edges: [{ id: "e1", fromNode: "a", toNode: "c" }],
};

/** Selection as a stable label: ids the fixture did not name are freshly minted. */
function ids(selection: CanvasSelection): string {
  const known = new Set(["a", "b", "c", "f", "e1"]);
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
let clipboard: { writes: string[] };

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
    },
  });
});

beforeEach(() => {
  clipboard = { writes: [] };
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The hook mounted over a recording context: what it did, and its applier. */
interface Mounted {
  readonly log: string[];
  readonly docs: CanvasDoc[];
  readonly apply: (intent: CanvasIntent) => void;
}

/** Mount the hook over a recording context and press one chord. */
function press(
  chord: Chord,
  selection: CanvasSelection = selectNode("a"),
  transforming = false,
  around: Surroundings = {},
): Recording {
  const mounted = mount(selection, transforming, around);
  const target: EventTarget = chord.onInput === true ? document.createElement("input") : window;
  if (target instanceof HTMLElement) document.body.appendChild(target);
  const event = new dom.KeyboardEvent("keydown", {
    key: chord.key,
    code: chord.code ?? "",
    metaKey: chord.metaKey ?? false,
    ctrlKey: chord.ctrlKey ?? false,
    shiftKey: chord.shiftKey ?? false,
    repeat: chord.repeat ?? false,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event as unknown as Event);
  });
  return { ...mounted, defaultPrevented: event.defaultPrevented };
}

/** Mount the hook and let the browser raise a paste carrying `text`, over a field when `onInput`. */
function paste(text: string, onInput = false, transforming = false): Recording {
  const mounted = mount(selectNode("a"), transforming, {});
  const target: EventTarget = onInput ? document.createElement("input") : window;
  if (target instanceof HTMLElement) document.body.appendChild(target);
  const data = new dom.DataTransfer();
  data.setData("text/plain", text);
  const event = new dom.ClipboardEvent("paste", {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event as unknown as Event);
  });
  return { ...mounted, defaultPrevented: event.defaultPrevented };
}

function mount(selection: CanvasSelection, transforming: boolean, around: Surroundings): Mounted {
  const log: string[] = [];
  const docs: CanvasDoc[] = [];
  const start = around.doc ?? doc;
  const docRef = { current: start };
  const selRef = { current: selection };
  let toolState: ToolState = { tool: "select" };
  let zoom = 1;
  const context = {
    cancelPointer: () => log.push("cancelPointer"),
    dispatchPointer: (event: { type: string }) => log.push(`pointer=${event.type}`),
    pointerAt: () => ({ x: 10, y: 20 }),
    transforming: () => transforming,
    presenting: () => around.presenting ?? false,
    present: (step: string) => log.push(`present=${step}`),
    toolArmed: around.toolArmed ?? false,
    scope: around.scope ?? null,
    leaveScope: () => {
      if ((around.scope ?? null) === null) return false;
      log.push("leave");
      return true;
    },
    byId: new Map(start.nodes.map((node) => [node.id, node])),
    docRef,
    selRef,
    schedulePersist: (next: CanvasDoc) => {
      docs.push(next);
      docRef.current = next;
      log.push("persist");
    },
    undoCanvasDoc: () => log.push("undo"),
    redoCanvasDoc: () => log.push("redo"),
    setSelection: (next: CanvasSelection | ((s: CanvasSelection) => CanvasSelection)) => {
      selRef.current = typeof next === "function" ? next(selRef.current) : next;
      log.push(`selection=${ids(selRef.current)}`);
    },
    setInspectorAnchor: () => log.push("anchor=null"),
    setItemInspectorAnchor: () => log.push("shapeAnchor=null"),
    choose: (chooser: string) => log.push(`choose=${chooser}`),
    setSpaceDown: () => log.push("space=true"),
    setToolState: (next: ToolState | ((s: ToolState) => ToolState)) => {
      toolState = typeof next === "function" ? next(toolState) : next;
      log.push(`tool=${toolState.tool}`);
    },
    viewport: {
      zoomBy: (factor: number) => {
        zoom *= factor;
        log.push(`zoom=${Math.round(zoom * 1000) / 1000}`);
      },
      zoomTo: (next: number) => {
        zoom = next;
        log.push(`zoom=${Math.round(zoom * 1000) / 1000}`);
      },
      frame: (items: readonly { id: string }[]) =>
        log.push(`frame=${items.map((item) => item.id).join("+")}`),
      look: (preset: string) => log.push(`look=${preset}`),
      toggleLens: () => log.push("lens"),
      faceOn: (item: { id: string }) => log.push(`faceOn=${item.id}`),
    },
    chooseProjection: (kind: string) => log.push(`projection=${kind}`),
    openViewMenu: () => log.push("viewMenu"),
  };

  const appliers: ((intent: CanvasIntent) => void)[] = [];
  function Probe() {
    const apply = useCanvasKeyboard(context);
    useEffect(() => {
      appliers.push(apply);
    });
    return null;
  }
  root = createRoot(container);
  act(() => root.render(<Probe />));
  return { log, docs, apply: (intent) => appliers.at(-1)?.(intent) };
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
    ["tool group (f)", { key: "f" }, ["tool=group"]],
    ["grab (g)", { key: "g" }, ["anchor=null", "shapeAnchor=null", "pointer=transform/begin"]],
    ["extrude (e)", { key: "e" }, ["anchor=null", "shapeAnchor=null", "pointer=transform/begin"]],
    ["kb-node picker (n)", { key: "n" }, ["tool=select", "choose=node"]],
    ["zoom in", { key: "=", metaKey: true }, ["zoom=1.15"]],
    ["zoom in (+)", { key: "+", metaKey: true }, ["zoom=1.15"]],
    ["zoom out", { key: "-", metaKey: true }, ["zoom=0.87"]],
    ["zoom reset", { key: "0", metaKey: true }, ["zoom=1"]],
    ["frame all", { key: "!", shiftKey: true }, ["frame=a+b"]],
    ["frame selection", { key: "@", code: "Digit2", shiftKey: true }, ["frame=a"]],
    ["frame selection (numpad .)", { key: ".", code: "NumpadDecimal" }, ["frame=a"]],
    // NumLock off: numpad . reports Delete, and still frames rather than deletes.
    ["frame selection (numpad Del)", { key: "Delete", code: "NumpadDecimal" }, ["frame=a"]],
    ["top view (numpad 7)", { key: "7", code: "Numpad7" }, ["look=top"]],
    ["front view (numpad 1)", { key: "1", code: "Numpad1" }, ["look=front"]],
    ["back view (⌃numpad 1)", { key: "1", code: "Numpad1", ctrlKey: true }, ["look=back"]],
    ["right view (numpad 3)", { key: "3", code: "Numpad3" }, ["look=right"]],
    ["left view (⌃numpad 3)", { key: "3", code: "Numpad3", ctrlKey: true }, ["look=left"]],
    ["lens (numpad 5)", { key: "5", code: "Numpad5" }, ["lens"]],
    ["no view from under the floor (⌃numpad 7)", { key: "7", code: "Numpad7", ctrlKey: true }, []],
    ["the top-row 7 keeps its tool", { key: "7", code: "Digit7" }, ["tool=group"]],
    ["view menu", { key: "`", code: "Backquote" }, ["viewMenu"]],
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

  const pastedCanvas = JSON.stringify({
    nodes: [{ id: "a", type: "shape", shape: "rect", x: 10, y: 20, width: 160, height: 100 }],
    edges: [],
  });

  test("⌘V is left to the browser, whose paste the canvas takes", () => {
    const recording = press({ key: "v", metaKey: true });
    expect(recording.log).toEqual([]);
    expect(recording.defaultPrevented).toBe(false);
  });

  test("a paste remaps ids, offsets by 24 and selects what it pasted", () => {
    const recording = paste(pastedCanvas);
    const pasted = recording.docs.at(-1);
    expect(pasted?.nodes).toHaveLength(3);
    const added = pasted?.nodes.at(-1);
    expect(added?.id).not.toBe("a");
    expect(added?.x).toBe(34);
    expect(added?.y).toBe(44);
    expect(recording.log).toEqual(["persist", "selection=<new>"]);
    expect(recording.defaultPrevented).toBe(true);
  });

  test("a paste of a non-canvas payload changes nothing and is left to the page", () => {
    const recording = paste("not a canvas");
    expect(recording.log).toEqual([]);
    expect(recording.docs).toEqual([]);
    expect(recording.defaultPrevented).toBe(false);
  });

  test("a paste into a field, or during a modal transform, is not the canvas's", () => {
    expect(paste(pastedCanvas, true).docs).toEqual([]);
    expect(paste(pastedCanvas, false, true).docs).toEqual([]);
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

describe("groups and frames", () => {
  const group = { nodeIds: new Set(["a", "b"]), edgeIds: new Set<string>() };

  test("⌘G gathers the selection into a frame round it, and selects the frame", () => {
    const recording = press({ key: "g", metaKey: true }, group);
    expect(recording.log).toEqual(["persist", "selection=<new>"]);
    expect(recording.defaultPrevented).toBe(true);
    const [frame, a, b] = recording.docs[0]?.nodes ?? [];
    expect(frame?.type).toBe("group");
    expect([a?.parent, b?.parent]).toEqual([frame?.id, frame?.id]);
    // A grid step to spare round them on the floor plan.
    expect([frame?.x, frame?.y, frame?.width, frame?.height]).toEqual([-20, -20, 500, 340]);
  });

  test("⌘⇧G takes the selected group apart and selects what it held; nothing selected, nothing", () => {
    const recording = press({ key: "G", metaKey: true, shiftKey: true }, selectNode("f"), false, {
      doc: framed,
    });
    expect(recording.log).toEqual(["persist", "selection=a+b"]);
    expect(recording.docs[0]?.nodes.map((n) => [n.id, n.parent])).toEqual([
      ["a", undefined],
      ["b", undefined],
      ["c", undefined],
    ]);
    const empty = press({ key: "g", metaKey: true }, EMPTY_SELECTION);
    expect(empty.log).toEqual([]);
    expect(empty.defaultPrevented).toBe(true);
  });

  test("a group carries its members: nudged, deleted and duplicated with it", () => {
    const frame = selectNode("f");
    const nudged = press({ key: "ArrowRight", shiftKey: true }, frame, false, { doc: framed });
    expect(nudged.docs[0]?.nodes.map((n) => n.x)).toEqual([-10, 10, 310, 900]);
    const deleted = press({ key: "Delete" }, frame, false, { doc: framed });
    expect(deleted.docs[0]?.nodes.map((n) => n.id)).toEqual(["c"]);
    expect(deleted.docs[0]?.edges).toEqual([]);
    const copied = press({ key: "d", metaKey: true }, frame, false, { doc: framed });
    const [, , , , copy, ...members] = copied.docs[0]?.nodes ?? [];
    expect(members.map((n) => n.parent)).toEqual([copy?.id, copy?.id]);
    expect(copied.log).toEqual(["persist", "selection=<new>"]);
  });

  test("⌘A in a group selects its members; at the canvas, its loose items and groups", () => {
    expect(press({ key: "a", metaKey: true }, EMPTY_SELECTION, false, { doc: framed }).log).toEqual(
      ["selection=c+e1+f"],
    );
    const inside = press({ key: "a", metaKey: true }, EMPTY_SELECTION, false, {
      doc: framed,
      scope: "f",
    });
    expect(inside.log).toEqual(["selection=a+b"]);
  });

  test("Escape with a tool armed in a group puts the tool down first, and only that", () => {
    const armed = press({ key: "Escape" }, selectNode("a"), false, {
      doc: framed,
      scope: "f",
      toolArmed: true,
    });
    expect(armed.log).toEqual(["cancelPointer", "tool=select"]);
  });

  test("Escape in a group leaves it, and does nothing else", () => {
    const recording = press({ key: "Escape" }, selectNode("a"), false, { doc: framed, scope: "f" });
    expect(recording.log).toEqual(["cancelPointer", "leave"]);
  });
});

describe("frames as viewpoints and present mode", () => {
  const presenting = (chord: Chord) => press(chord, selectNode("a"), false, { presenting: true });

  test("the arrows, Space and the page keys step through the frames; Escape stops", () => {
    expect(presenting({ key: "ArrowRight" }).log).toEqual(["present=next"]);
    expect(presenting({ key: " ", code: "Space" }).log).toEqual(["present=next"]);
    expect(presenting({ key: "PageDown" }).log).toEqual(["present=next"]);
    expect(presenting({ key: " ", code: "Space", shiftKey: true }).log).toEqual([
      "present=previous",
    ]);
    expect(presenting({ key: "ArrowLeft" }).log).toEqual(["present=previous"]);
    const stop = presenting({ key: "Escape" });
    expect(stop.log).toEqual(["present=stop"]);
    expect(stop.defaultPrevented).toBe(false);
    // Not presenting, an arrow nudges as ever.
    expect(press({ key: "ArrowRight" }).log).toEqual(["persist"]);
  });

  test("going to a frame looks at it face-on; Present starts the deck", () => {
    const recording = press({ key: "Shift" }, EMPTY_SELECTION, false, { doc: framed });
    act(() => recording.apply({ type: "viewpoint", id: "f" }));
    act(() => recording.apply({ type: "viewpoint", id: "gone" }));
    act(() => recording.apply({ type: "present", act: "start" }));
    expect(recording.log).toEqual(["faceOn=f", "present=start"]);
  });
});

describe("during a modal transform", () => {
  const during = (chord: Chord) => press(chord, selectNode("a"), true);

  test("a key acts once: held, it does not repeat, but Backspace does", () => {
    expect(during({ key: "x" }).log).toEqual(["pointer=transform/key"]);
    expect(during({ key: "x", repeat: true }).log).toEqual([]);
    expect(during({ key: "4", repeat: true }).log).toEqual([]);
    expect(during({ key: "Backspace", repeat: true }).log).toEqual(["pointer=transform/key"]);
  });

  test("Escape cancels it and only it; a tool key does nothing", () => {
    expect(during({ key: "Escape" }).log).toEqual(["cancelPointer"]);
    expect(during({ key: "t" }).log).toEqual([]);
  });

  test("focus going anywhere cancels it, as the window losing focus does", () => {
    const recording = during({ key: "Shift" });
    expect(recording.log).toEqual([]);
    const field = document.createElement("input");
    document.body.appendChild(field);
    act(() => {
      field.dispatchEvent(new dom.Event("focusin", { bubbles: true }) as unknown as Event);
    });
    expect(recording.log).toEqual(["cancelPointer"]);
    act(() => {
      window.dispatchEvent(new dom.Event("blur") as unknown as Event);
    });
    expect(recording.log).toEqual(["cancelPointer", "space=true", "cancelPointer"]);
    field.remove();
  });

  test("unmounted, the canvas listens to nothing", () => {
    const recording = during({ key: "Shift" });
    act(() => root.unmount());
    act(() => {
      window.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "x" }) as unknown as Event);
      window.dispatchEvent(new dom.Event("blur") as unknown as Event);
      document.body.dispatchEvent(new dom.Event("focusin", { bubbles: true }) as unknown as Event);
    });
    expect(recording.log).toEqual([]);
    root = createRoot(container);
  });
});
