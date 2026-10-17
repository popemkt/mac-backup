/**
 * The Locations section and the page's open (DESIGN.md → Locations): the
 * rows `location.list` answers are drawn with what each is now, a row that
 * cannot be opened offers Forget, a home store that cannot be read is said
 * in the section alone, and an open goes to the URL it answers, in this tab
 * or a new one, or stays put and says why.
 *
 * The section reaches the server only through the page's host, so a test
 * host's `invoke` stands in for it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { ActionReceipt } from "@kb/contracts";
import type { LocationList, LocationRow } from "@kb/locations";
import { setToastSink, syncUiPlugins, type BrowserHost } from "@kb/ui-sdk";
import {
  installDomGlobals,
  testBrowserHost,
  testHostPlugin,
  type InstalledDom,
} from "@kb/ui-test-kit";
import { openLocation, type PageExits } from "./open";
import { LocationsSection } from "./section";

const at = { pinned: false, current: false, backend: "jsonl" as const };
const ROWS: LocationRow[] = [
  {
    ...at,
    id: "here",
    label: "dotfiles",
    path: "/r/dotfiles",
    status: "served",
    current: true,
    url: "http://127.0.0.1:4321",
  },
  { ...at, id: "notes", label: "notes", path: "/r/notes", status: "closed" },
  {
    id: "gone",
    label: "old",
    path: "/r/old",
    pinned: false,
    current: false,
    status: "missing",
    reason: "no such directory",
  },
];

/** Answers each call as `answer` says, and records it. */
function invoker(answer: (id: string, input: unknown) => ActionReceipt) {
  const calls: { id: string; input: unknown }[] = [];
  const invoke: BrowserHost["invoke"] = (id, input) => {
    calls.push({ id, input });
    return Promise.resolve(answer(id, input));
  };
  return { calls, invoke };
}

const listed = (list: LocationList): ActionReceipt => ({
  status: "succeeded",
  id: "location.list",
  output: list,
});

/** Exits that record where the page went, and the tabs it opened and closed. */
function recordedExits() {
  const went: string[] = [];
  const tabs: { url: string | null; closed: boolean }[] = [];
  const exits: PageExits = {
    assign: (url) => went.push(url),
    openTab: () => {
      const tab = { url: null as string | null, closed: false };
      tabs.push(tab);
      return { go: (url) => (tab.url = url), close: () => (tab.closed = true) };
    },
  };
  return { went, tabs, exits };
}

/** Each button the section draws: its text, and the status its dot names. */
const buttons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button"), (button) => ({
    text: button.textContent,
    status: button.querySelector("[role=img]")?.getAttribute("aria-label") ?? null,
  }));

describe("opening a location", () => {
  let toasts: string[] = [];
  beforeEach(() => {
    toasts = [];
    setToastSink((message) => toasts.push(message));
  });

  const opened: ActionReceipt = {
    status: "succeeded",
    id: "location.open",
    output: { url: "http://127.0.0.1:5000", path: "/r/notes" },
  };

  test("goes to the URL it answers in this tab, and a new tab when asked", async () => {
    const { calls, invoke } = invoker(() => opened);
    const { went, tabs, exits } = recordedExits();
    await openLocation(invoke, { id: "notes" }, false, exits);
    await openLocation(invoke, { id: "notes" }, true, exits);
    expect(calls).toEqual([
      { id: "location.open", input: { id: "notes" } },
      { id: "location.open", input: { id: "notes" } },
    ]);
    expect(went).toEqual(["http://127.0.0.1:5000"]);
    expect(tabs).toEqual([{ url: "http://127.0.0.1:5000", closed: false }]);
  });

  test("a refused open stays put, closes the tab it opened, and says why", async () => {
    const { invoke } = invoker(() => ({
      status: "failed",
      id: "location.open",
      code: "not_found",
      message: "/r/old: no such directory",
    }));
    const { went, tabs, exits } = recordedExits();
    await openLocation(invoke, { id: "gone" }, true, exits);
    expect(went).toEqual([]);
    expect(tabs).toEqual([{ url: null, closed: true }]);
    expect(toasts).toEqual(["/r/old: no such directory"]);
  });
});

describe("the Locations section", () => {
  let dom: InstalledDom;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals("https://kb.test/");
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => dom.restore());
  afterEach(() => {
    act(() => root.unmount());
    syncUiPlugins([]);
  });

  async function show(invoke: BrowserHost["invoke"]): Promise<HTMLElement> {
    syncUiPlugins([testHostPlugin(testBrowserHost({ invoke }))]);
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    await act(async () => root.render(<LocationsSection />));
    return container;
  }

  test("draws each row with what it is now, and offers Forget for one that cannot be opened", async () => {
    const { invoke } = invoker(() => listed({ home: "/h", rows: ROWS, warnings: [] }));
    const container = await show(invoke);
    expect(container.textContent).toContain("Locations");
    expect(buttons(container)).toEqual([
      { text: "dotfiles", status: "served" },
      { text: "notes", status: "closed" },
      { text: "old", status: "missing" },
      { text: "Forget · no such directory", status: null },
    ]);
  });

  test("Forget forgets the row and reads the list again", async () => {
    let rows = ROWS;
    const { calls, invoke } = invoker((id) => {
      if (id === "location.forget") {
        rows = rows.filter((row) => row.id !== "gone");
        return { status: "succeeded", id, output: {} };
      }
      return listed({ home: "/h", rows, warnings: [] });
    });
    const container = await show(invoke);
    const forget = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent.startsWith("Forget"),
    );
    await act(async () => forget?.click());
    expect(calls.map(({ id }) => id)).toEqual([
      "location.list",
      "location.forget",
      "location.list",
    ]);
    expect(buttons(container).map(({ text }) => text)).toEqual(["dotfiles", "notes"]);
  });

  test("a page no server answers says so in the section", async () => {
    const offline = await show(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(buttons(offline).map(({ text }) => text)).toEqual([
      "Locations unavailable: location.list could not be called: TypeError: Failed to fetch",
    ]);
  });

  test("a home store that cannot be read is said in the section, and a warning is shown", async () => {
    const failing = await show(
      invoker(() => ({
        status: "failed",
        id: "location.list",
        code: "internal",
        message: "home store unreadable at /h: bad line",
      })).invoke,
    );
    expect(failing.textContent).toContain(
      "Locations unavailable: home store unreadable at /h: bad line",
    );
    act(() => root.unmount());
    // The kernel keeps a host it already holds by name, so the next one is loaded afresh.
    syncUiPlugins([]);
    const empty = await show(
      invoker(() => listed({ home: "/h", rows: [], warnings: ["no home store yet at /h"] })).invoke,
    );
    expect(buttons(empty).map(({ text }) => text)).toEqual(["no home store yet at /h"]);
  });
});
