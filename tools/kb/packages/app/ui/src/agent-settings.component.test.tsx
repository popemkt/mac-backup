/**
 * The agent's settings in its dock (`DESIGN.md` → Agent packages →
 * providers): the agent node's `provider` field and the selected provider's
 * `model`, drawn with the page's field editor as any field is. Choosing a
 * provider is a write of that field, which the page's write rule admits
 * because the field configures the agent's node; nothing else about the
 * node is writable.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { WireNode } from "@kb/contracts";
import { AGENT_IDS, adapterOptionId } from "@kb/agent";
import { bundledSeed } from "@kb/bundled";
import { SYSTEM_IDS, extensionNodeId } from "@kb/model";
import { syncUiPlugins } from "@kb/ui-sdk";
import { installDomGlobals, type InstalledDom } from "@kb/ui-test-kit";
import { AgentDock, attachChat } from "@kb/agent-ui";
import { outlineUiPlugin } from "@kb/outline-ui";
import { mutations } from "@/actions/mutations";
import { fixtureGraph } from "@/api/fixture-graph";
import { useGraphStore } from "@/stores/graph.store";
import { syncPagePlugins } from "@/test-support/page-plugins";

const AT = "2026-01-01T00:00:00.000Z";
const AGENT = extensionNodeId("agent");

const PROXY: WireNode = {
  id: "n.proxy",
  text: "Local proxy",
  props: {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: AGENT_IDS.providerTag }],
    [AGENT_IDS.adapterField]: [{ t: "ref", v: adapterOptionId("openai-chat") }],
    [AGENT_IDS.endpointField]: [{ t: "str", v: "http://127.0.0.1:8317/v1" }],
    [AGENT_IDS.modelField]: [{ t: "str", v: "deepseek-v4-flash" }],
  },
  children: [],
  createdAt: AT,
  updatedAt: AT,
};

/** The seed, a provider, and the agent's node selecting `selected` (or nothing). */
function graphWith(selected: string | null): WireNode[] {
  return [
    ...bundledSeed(AT).map((node): WireNode => {
      if (node.id !== AGENT || selected === null) return node;
      return { ...node, props: { [AGENT_IDS.providerField]: [{ t: "ref", v: selected }] } };
    }),
    PROXY,
  ];
}

describe("the agent's settings in its dock", () => {
  let installed: InstalledDom;
  let container: HTMLElement;
  let root: Root;
  let detach: () => void;

  beforeAll(() => {
    installed = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => installed.restore());

  // The outline provides the page's field editor.
  beforeAll(() => syncPagePlugins([outlineUiPlugin]));
  afterAll(() => syncUiPlugins([]));

  function open(nodes: WireNode[]): HTMLElement {
    useGraphStore.getState().hydrateFromWire(nodes, 1, "fixtures");
    detach = attachChat({
      listen: () => () => undefined,
      send: () => undefined,
      connection: () => () => undefined,
      invoke: () => Promise.reject(new Error("no calls")),
      newConversation: () => "k1",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(AgentDock, { onClose: () => undefined })));
    const settings = container.querySelector('[aria-label="Agent settings"]');
    if (!(settings instanceof window.HTMLElement)) throw new Error("the dock draws no settings");
    return settings;
  }

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    detach();
    useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
  });

  it("with nothing selected, it offers the provider field and no model", () => {
    const settings = open(graphWith(null));
    expect(settings.querySelectorAll("[data-field-row]")).toHaveLength(1);
    expect(settings.textContent).toContain("provider");
    expect(settings.textContent).not.toContain("model");
  });

  it("with a provider selected, it shows the provider and that provider's model", () => {
    const settings = open(graphWith(PROXY.id));
    expect(settings.textContent).toContain("Local proxy");
    expect(settings.textContent).toContain("model");
    expect(settings.textContent).toContain("deepseek-v4-flash");
  });

  it("choosing a provider writes the agent node's setting, and only that", async () => {
    open(graphWith(null));
    await act(() =>
      mutations.updateProp(AGENT, AGENT_IDS.providerField, { t: "ref", v: PROXY.id }),
    );
    const agent = useGraphStore.getState().index?.getNode(AGENT);
    expect(agent?.props[AGENT_IDS.providerField]).toEqual([{ t: "ref", v: PROXY.id }]);
    expect(container.textContent).toContain("deepseek-v4-flash");
  });
});
