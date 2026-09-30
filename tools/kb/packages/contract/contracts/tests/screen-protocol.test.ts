import { describe, expect, test } from "bun:test";
import {
  ClientMessageSchema,
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "../src/protocol.ts";
import {
  UiNavigateInputSchema,
  UiSelectInputSchema,
  navigateCommand,
  noTabReceipt,
  selectCommand,
  type PaneScreen,
  type ScreenState,
} from "../src/screen.ts";

const pane: PaneScreen = {
  id: "main",
  view: { key: "outline.main", subject: "n.root" },
  focused: "n.a",
  selection: ["n.a"],
};

const outline: ScreenState = { route: "/", active: true, activePane: "main", panes: [pane] };

/** Encode as the socket does, then decode as the other end does. */
function overTheWire<T>(schema: { parse(value: unknown): T }, message: T): T {
  return schema.parse(JSON.parse(JSON.stringify(message)));
}

describe("screen messages on /ws", () => {
  test("a tab's screen survives the wire", () => {
    const msg: ClientMessage = { op: "screen", state: outline };
    expect(overTheWire(ClientMessageSchema, msg)).toEqual(msg);
  });

  test("a canvas pane carries its viewport and visible items", () => {
    const msg: ClientMessage = {
      op: "screen",
      state: {
        route: "/canvas/n.c",
        active: false,
        activePane: "main",
        panes: [
          {
            id: "main",
            view: { key: "canvas.page", subject: "n.c" },
            focused: null,
            selection: ["item-1"],
            canvas: { viewport: { x: -40, y: 12.5, zoom: 1.5 }, visible: ["item-1", "item-2"] },
          },
        ],
      },
    };
    expect(overTheWire(ClientMessageSchema, msg)).toEqual(msg);
  });

  test("a tab of several panes is the same message, naming its active pane", () => {
    const state: ScreenState = {
      ...outline,
      activePane: "right",
      panes: [
        { ...pane, id: "left" },
        { id: "right", view: null, focused: null, selection: [] },
      ],
    };
    expect(overTheWire(ClientMessageSchema, { op: "screen", state })).toEqual({
      op: "screen",
      state,
    });
  });

  test("a screen whose active pane is not one of its panes is refused", () => {
    const bad = { op: "screen", state: { ...outline, activePane: "elsewhere" } };
    expect(ClientMessageSchema.safeParse(bad).success).toBe(false);
  });

  test("a screen with two panes of one id is refused", () => {
    const bad = { op: "screen", state: { ...outline, panes: [pane, pane] } };
    expect(ClientMessageSchema.safeParse(bad).success).toBe(false);
  });

  test("a screen with no pane, or a route that is not a path, is refused", () => {
    expect(
      ClientMessageSchema.safeParse({ op: "screen", state: { ...outline, panes: [] } }).success,
    ).toBe(false);
    expect(
      ClientMessageSchema.safeParse({ op: "screen", state: { ...outline, route: "canvas" } })
        .success,
    ).toBe(false);
  });

  test("commands and their answers survive the wire", () => {
    const commands: ServerMessage[] = [
      { op: "screen-command", id: "c1", command: { kind: "navigate", to: { node: "n.a" } } },
      {
        op: "screen-command",
        id: "c2",
        command: { kind: "navigate", pane: "main", to: { route: "/graph" } },
      },
      {
        op: "screen-command",
        id: "c3",
        command: { kind: "select", selection: ["n.a", "n.b"], focus: "n.b" },
      },
    ];
    for (const msg of commands) expect(overTheWire(ServerMessageSchema, msg)).toEqual(msg);
    const answers: ClientMessage[] = [
      { op: "screen-ack", id: "c1", result: { outcome: "applied" } },
      { op: "screen-ack", id: "c2", result: { outcome: "rejected", reason: "no such pane" } },
    ];
    for (const msg of answers) expect(overTheWire(ClientMessageSchema, msg)).toEqual(msg);
  });

  test("a navigate to both a node and a route is refused", () => {
    const bad = {
      op: "screen-command",
      id: "c1",
      command: { kind: "navigate", to: { node: "n.a", route: "/" } },
    };
    expect(ServerMessageSchema.safeParse(bad).success).toBe(false);
  });

  test("an answer that is neither applied nor rejected is refused", () => {
    const bad = { op: "screen-ack", id: "c1", result: { outcome: "timeout" } };
    expect(ClientMessageSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ui.* inputs and the commands they become", () => {
  test("ui.navigate takes exactly one of node or route", () => {
    expect(UiNavigateInputSchema.safeParse({ node: "n.a" }).success).toBe(true);
    expect(UiNavigateInputSchema.safeParse({ route: "/canvas" }).success).toBe(true);
    expect(UiNavigateInputSchema.safeParse({}).success).toBe(false);
    expect(UiNavigateInputSchema.safeParse({ node: "n.a", route: "/" }).success).toBe(false);
    // An MCP client may send an omitted optional as null.
    expect(UiNavigateInputSchema.safeParse({ node: "n.a", route: null, tab: null }).success).toBe(
      true,
    );
  });

  test("ui.select takes a selection, a focus, or both", () => {
    expect(UiSelectInputSchema.safeParse({ selection: [] }).success).toBe(true);
    expect(UiSelectInputSchema.safeParse({ focus: "n.a" }).success).toBe(true);
    expect(UiSelectInputSchema.safeParse({ focus: null, selection: null }).success).toBe(false);
  });

  test("an input becomes its command, less the tab and the timeout", () => {
    const navigate = UiNavigateInputSchema.parse({
      tab: "t",
      pane: "main",
      node: "n.a",
      timeoutMs: 5,
    });
    expect(navigateCommand(navigate)).toEqual({
      kind: "navigate",
      pane: "main",
      to: { node: "n.a" },
    });
    const route = UiNavigateInputSchema.parse({ route: "/graph", pane: null });
    expect(navigateCommand(route)).toEqual({ kind: "navigate", to: { route: "/graph" } });
    const select = UiSelectInputSchema.parse({ tab: "t", focus: "n.a", selection: null });
    expect(selectCommand(select)).toEqual({ kind: "select", focus: "n.a" });
  });

  test("no-tab names the tab asked for, and only that", () => {
    expect(noTabReceipt(undefined)).toEqual({ outcome: "no-tab" });
    expect(noTabReceipt("t")).toEqual({ outcome: "no-tab", tab: "t" });
  });
});
