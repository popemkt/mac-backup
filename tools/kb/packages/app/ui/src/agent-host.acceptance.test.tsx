/**
 * The agent's dock through the real App follows the server that hosts the
 * agent: a page whose `kb.manifest` reports the agent loaded (a `kb ui` that
 * hosts it) offers the Agent toggle, and a page whose server reports none
 * (the agent switched off, or a server that hosts none) offers none,
 * whatever this browser chose before.
 * There is no second switch in the browser.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agentExtension } from "@kb/agent";
import { BUNDLED_FAMILIES } from "@kb/bundled";
import {
  NO_SWITCHES,
  extensionRow,
  familyOn,
  type ActionInvocation,
  type GraphSnapshot,
} from "@kb/contracts";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";

const { App } = await import("@/components/App");
const { setFetchGraphSnapshot } = await import("@/api/graph");
const { setPostAction } = await import("@/api/action");
const { servedManifest } = await import("@/lib/manifest");

const ISO = "2026-10-04T00:00:00.000Z";

function snapshot(): GraphSnapshot {
  return {
    rev: 1,
    nodes: [{ id: "n.a", text: "a note", props: {}, children: [], createdAt: ISO, updatedAt: ISO }],
  };
}

/** Whether the stand-in server hosts the agent. */
const server = { agent: false };

async function answer(invocation: ActionInvocation) {
  if (invocation.id !== "kb.manifest") {
    return {
      status: "failed" as const,
      id: invocation.id,
      code: "unknown_action" as const,
      message: "none",
      rev: 1,
    };
  }
  const extensions = [
    ...BUNDLED_FAMILIES.map((declaration) =>
      extensionRow(
        declaration,
        "bundled",
        familyOn(declaration, NO_SWITCHES, () => {}),
      ),
    ),
    ...(server.agent ? [extensionRow(agentExtension, "host", true)] : []),
  ];
  return {
    status: "succeeded" as const,
    id: invocation.id,
    output: { actions: [], views: [], extensions },
    rev: 1,
  };
}

async function until(ready: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("the agent's dock follows the server that hosts it (acceptance)", () => {
  let dom: InstalledDom;
  let container: HTMLElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    const g = globalThis as Record<string, unknown>;
    g.PointerEvent = dom.window.MouseEvent;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    g.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
    g.WebSocket = class {
      close(): void {}
      send(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    };
    setFetchGraphSnapshot(() => Promise.resolve(snapshot()));
    setPostAction(answer);
  });

  afterAll(() => {
    setFetchGraphSnapshot(null);
    setPostAction(null);
    dom.restore();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** Render the App over the server as it is, and wait until the page has heard it. */
  async function boot(): Promise<void> {
    container = dom.window.document.createElement("div") as unknown as HTMLElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    const hosted = () => servedManifest()?.extensions.some(({ name }) => name === "agent");
    await until(() => hosted() === server.agent);
  }

  const agentToggle = () => container.querySelector('button[title="Agent"]');
  const canvasRow = () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "Canvases");

  it("offers the Agent toggle when the server hosts the agent", async () => {
    server.agent = true;
    await boot();
    // The agent's entry is a lazy chunk: wait for it to load.
    await until(() => agentToggle() !== null);
    expect(agentToggle()).not.toBeNull();
  });

  it("offers none when the server hosts no agent, while it draws the families it reports", async () => {
    server.agent = false;
    await boot();
    await until(() => agentToggle() === null && canvasRow() !== undefined);
    expect(servedManifest()?.extensions.map(({ name }) => name)).not.toContain("agent");
    // The page followed this report: the canvas it lists is drawn, the agent it omits is not.
    expect(canvasRow()).toBeDefined();
    expect(agentToggle()).toBeNull();
  });
});
