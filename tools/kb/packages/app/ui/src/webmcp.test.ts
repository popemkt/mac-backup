/**
 * The page's WebMCP plugin is bound to the browser's one invoke path: a local
 * read is answered by the replica and pushes nothing, anything else goes to
 * `POST /api/action`, and the listing comes from `kb.manifest` on that path.
 * What the adapter promises for the whole registry is the surface contract's
 * business (`packages/app/cli/tests/surface-contract.test.ts`).
 */
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionInvocation, ActionResponse, ManifestEntry } from "@kb/contracts";
import { makeKernel } from "@kb/plugin";
import type { ModelContextTool } from "@kb/webmcp";
import { setPostAction } from "@/api/action";
import { fixtureGraph } from "@/api/fixture-graph";
import { setBrowserLink, waitForBrowserPushes } from "@/session/runtime";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { webMcpUiPlugin } from "@/webmcp";

function entry(id: string, mode: ManifestEntry["mode"]): ManifestEntry {
  return { id, title: id, description: id, mode, inputSchema: {}, outputSchema: {} };
}

const MANIFEST = [
  entry("node.get", { kind: "read" }),
  entry("render.views", { kind: "read" }),
  entry("ext.gated.stamp", { kind: "write", approval: "required" }),
];

/** The page's model context: the tools registered now, each leaving when its signal aborts. */
function installModelContext(): Map<string, ModelContextTool> {
  const tools = new Map<string, ModelContextTool>();
  const modelContext = {
    registerTool: (tool: ModelContextTool, options?: { signal?: AbortSignal }) => {
      tools.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => tools.delete(tool.name));
      return Promise.resolve();
    },
  };
  Object.defineProperty(document, "modelContext", { value: modelContext, configurable: true });
  return tools;
}

function serverAnswering() {
  return vi.fn(
    (invocation: ActionInvocation): Promise<ActionResponse> =>
      Promise.resolve(
        invocation.id === "kb.manifest"
          ? { status: "succeeded", id: invocation.id, output: { actions: MANIFEST }, rev: 1 }
          : { status: "succeeded", id: invocation.id, output: "from the server", rev: 1 },
      ),
  );
}

async function settle(): Promise<void> {
  await waitForBrowserPushes();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the page's WebMCP plugin", () => {
  let dom: InstalledDom;
  beforeEach(() => {
    dom = installDomGlobals();
  });
  afterEach(() => {
    dom.restore();
    setPostAction(null);
    setBrowserLink(null);
  });

  it("registers what kb.manifest lists, less what WebMCP cannot approve, and leaves on unload", async () => {
    const tools = installModelContext();
    const post = serverAnswering();
    setPostAction(post);
    const kernel = makeKernel();
    Effect.runSync(kernel.load(webMcpUiPlugin));
    await settle();
    expect(post).toHaveBeenCalledWith({ id: "kb.manifest", input: {} });
    expect([...tools.keys()]).toEqual(["node.get", "render.views"]);
    Effect.runSync(kernel.unload("webmcp"));
    expect([...tools.keys()]).toEqual([]);
  });

  it("runs a local read on the replica and anything else on the server", async () => {
    useOutlineStore.getState().hydrateFromWire(structuredClone(fixtureGraph.nodes), 1, "api");
    const tools = installModelContext();
    const post = serverAnswering();
    setPostAction(post);
    const kernel = makeKernel();
    Effect.runSync(kernel.load(webMcpUiPlugin));
    await settle();
    post.mockClear();

    expect(await tools.get("node.get")?.execute({ id: "n.root-a", depth: 0 })).toMatchObject({
      status: "succeeded",
      output: { node: { id: "n.root-a" } },
    });
    expect(post).not.toHaveBeenCalled();

    expect(await tools.get("render.views")?.execute({})).toEqual({
      status: "succeeded",
      id: "render.views",
      output: "from the server",
    });
    expect(post).toHaveBeenCalledWith({ id: "render.views", input: {} });
    Effect.runSync(kernel.unload("webmcp"));
  });

  it("lists again when the live socket opens", async () => {
    installModelContext();
    const post = serverAnswering();
    setPostAction(post);
    useUiStore.getState().setWsStatus("closed");
    const kernel = makeKernel();
    Effect.runSync(kernel.load(webMcpUiPlugin));
    await settle();
    post.mockClear();
    useUiStore.getState().setWsStatus("open");
    await settle();
    expect(post).toHaveBeenCalledWith({ id: "kb.manifest", input: {} });
    Effect.runSync(kernel.unload("webmcp"));
  });

  it("does nothing where the browser has no model context", async () => {
    const post = serverAnswering();
    setPostAction(post);
    const kernel = makeKernel();
    Effect.runSync(kernel.load(webMcpUiPlugin));
    await settle();
    expect(post).not.toHaveBeenCalled();
    Effect.runSync(kernel.unload("webmcp"));
  });
});
