/**
 * The graph renderer contract (DESIGN-UI.md → Graph → Look and motion): what
 * every renderer view the graph plugin provides promises, proved over each
 * one that the unit run can mount — through a `ViewSlot` inside a graph
 * frame, the way the graph page draws it.
 *
 * - **dispose on switch**: another renderer taking the frame leaves nothing of
 *   this one behind — no DOM, no observer, no scene;
 * - **tokens re-read on appearance change**: a renderer that copies token
 *   values out (a canvas or a GPU palette) reads them again when the
 *   appearance changes; a DOM renderer paints live `var()`s and copies none;
 * - **selection beats hover**: with a node selected, hovering another one
 *   does not move the focus — the one rule, `graphFocus`.
 *
 * A new renderer joins by its registration: the provided renderer views and
 * this table must list the same renderers. The 2D renderers draw through sigma, which needs
 * a WebGL2 context happy-dom lacks; their rows are todo, named by a gap.
 */
import { act, useMemo, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { Effect, Result } from "effect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeKernel } from "@kb/plugin";
import { EmphasisFade } from "@/lib/graph-fade";
import {
  buildTreeForest,
  LENS_THEMES,
  type LensEdge,
  type LensNode,
  type LensPerspective,
  type LensTheme,
} from "@/lib/graph-lens";
import type { Appearance } from "@/stores/prefs.store";
import type { Force3dScene } from "./force3d-scene";
import type { GraphFrame } from "./graph-frame";
import type * as CssColor from "@/lib/css-color";

const probes = vi.hoisted(() => ({
  tokenReads: 0,
  scenes: { live: 0, palettes: 0 },
  noop: () => {},
}));

vi.mock("@/lib/css-color", async (importOriginal) => {
  const real = await importOriginal<typeof CssColor>();
  return {
    ...real,
    readTokenColor: (...args: Parameters<typeof real.readTokenColor>) => {
      probes.tokenReads += 1;
      return real.readTokenColor(...args);
    },
  };
});

vi.mock("./force3d-scene", () => ({
  mountForce3d: (): Promise<Force3dScene> => {
    probes.scenes.live += 1;
    const { noop } = probes;
    return Promise.resolve({
      backend: "WebGL2",
      controls: { fit: noop, zoomIn: noop, zoomOut: noop, reset: noop, focusNode: noop },
      setGraph: noop,
      setSettings: noop,
      setEmphasis: noop,
      setPalette: () => {
        probes.scenes.palettes += 1;
      },
      setReducedMotion: noop,
      resize: noop,
      setRunning: noop,
      inspect: () => {
        throw new Error("not in this suite");
      },
      dispose: () => {
        probes.scenes.live -= 1;
      },
    });
  },
}));

const { graphUiPlugin } = await import("./plugin");
const { ViewSlot } = await import("@/components/ui/view-slot");
const { GraphFrameContext } = await import("./graph-frame");
const { TreemapView, isRendererKey } = await import("./views");
const { ViewPoint, familyViews, syncUiPlugins } = await import("@/lib/plugins");
const { localIdOf, paramsFrom } = await import("@/lib/view-key");
const { setEmphasisTargets, topologyOf } = await import("./force3d-emphasis");

// --- a graph with two separate neighbourhoods: A–C and B–D -----------------

const node = (id: string, degree: number): LensNode => ({
  id,
  label: `node ${id}`,
  color: "#6366f1",
  size: 4,
  clusterKey: "r",
  tags: [],
  degree,
  weight: 1,
});
const NODES = [node("A", 1), node("B", 1), node("C", 1), node("D", 1)];
const EDGES: LensEdge[] = [
  { source: "A", target: "C", kind: "child", weight: 1 },
  { source: "B", target: "D", kind: "child", weight: 1 },
];
const PERSPECTIVE: LensPerspective = {
  id: "lens.contract",
  label: "Contract",
  query: "",
  renderer: "tree",
  colorBy: "tag",
  sizeBy: "degree",
  edgeKinds: ["child"],
  maxNodes: 100,
  clusterBy: "none",
  focus: null,
  hops: null,
  layout: "force",
  spread: 150,
  linkDistance: 60,
  showLabels: true,
  autorotate: false,
  labelDensity: "medium",
  theme: "matte",
  linkStyle: "straight",
};
const LIGHT: Appearance = { designSystem: "kb", dark: false, key: "kb:light" };
const DARK: Appearance = { designSystem: "kb", dark: true, key: "kb:dark" };

/** Every renderer view the graph plugin provides, by its name in `lens.renderer`. */
const RENDERERS = (() => {
  const kernel = makeKernel();
  Effect.runSync(kernel.load(graphUiPlugin));
  const renderers = familyViews(kernel.contributions(ViewPoint), isRendererKey);
  return new Map(renderers.map(({ key }) => [localIdOf(key), key]));
})();

/** Each renderer's row: how the suite reaches it, and what it copies out of the tokens. */
interface ContractRow {
  readonly mountable: boolean;
  readonly copiesTokens: boolean;
  /** The renderer is on screen (the 3D host loads lazily and mounts a scene). */
  readonly ready: () => boolean;
}
const drawn = () => true;
const CONTRACT: Record<string, ContractRow> = {
  force2d: { mountable: false, copiesTokens: true, ready: drawn },
  cluster: { mountable: false, copiesTokens: true, ready: drawn },
  tree: { mountable: true, copiesTokens: true, ready: drawn },
  treemap: { mountable: true, copiesTokens: false, ready: drawn },
  force3d: { mountable: true, copiesTokens: true, ready: () => probes.scenes.live > 0 },
};

let dom: Window;
let container: HTMLDivElement;
let root: Root;
const observers = { live: 0 };

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await act(async () => Promise.resolve());
}

/** Settle until `ready` holds, or fail after a few seconds of real time. */
async function until(ready: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("the renderer never came on screen");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  await settle();
}

/** A graph host holding the contract graph, painted in `appearance`. */
function ContractHost({
  appearance,
  selected,
  children,
}: {
  readonly appearance: Appearance;
  readonly selected: string | null;
  readonly children: ReactNode;
}) {
  const frame = useMemo(
    (): GraphFrame => ({
      lensGraph: { nodes: NODES, edges: EDGES, dropped: 0, queryError: null },
      forest: buildTreeForest(NODES, EDGES, null),
      layoutKey: PERSPECTIVE.id,
      viewKey: "contract",
      appearance,
      searchHighlight: null,
      filterIds: null,
      selection:
        selected === null ? null : { nodeId: selected, label: selected, tags: [], degree: 1 },
      setSelection: () => {},
      setControls: () => {},
      onNodeOpen: () => {},
    }),
    [appearance, selected],
  );
  return <GraphFrameContext.Provider value={frame}>{children}</GraphFrameContext.Provider>;
}

/** The renderer named `name`, drawn in a slot inside a graph frame, as the page draws it. */
function adapter(
  name: string,
  appearance: Appearance,
  selected: string | null = null,
  theme: LensTheme = PERSPECTIVE.theme,
): ReactElement {
  const key = RENDERERS.get(name);
  if (key === undefined) throw new Error(name);
  const settings = paramsFrom(key, { ...PERSPECTIVE, renderer: name, theme });
  if (Result.isFailure(settings)) throw new Error(settings.failure);
  return (
    <ContractHost appearance={appearance} selected={selected}>
      <ViewSlot
        view={key}
        params={settings.success}
        placement="page"
        fallback={<p data-renderer-missing="true" />}
        pending={<p data-renderer-loading="true" />}
      />
    </ContractHost>
  );
}

/** The renderer's chunk has arrived and it is on screen. */
const shownWhen = (ready: () => boolean) => () =>
  container.querySelector("[data-renderer-loading]") === null && ready();

describe("graph renderer contract", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();

  beforeAll(() => {
    syncUiPlugins([graphUiPlugin]);
    dom = new Window();
    const globals: Record<string, unknown> = {
      window: dom,
      document: dom.document,
      HTMLElement: dom.HTMLElement,
      Node: dom.Node,
      IS_REACT_ACT_ENVIRONMENT: true,
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      getComputedStyle: dom.getComputedStyle.bind(dom),
      ResizeObserver: class {
        observe() {
          observers.live += 1;
        }
        disconnect() {
          observers.live -= 1;
        }
      },
    };
    for (const [key, value] of Object.entries(globals)) {
      saved.set(key, g[key]);
      g[key] = value;
    }
    Object.defineProperty(dom.document, "fonts", { value: { ready: Promise.resolve() } });
  });

  afterAll(() => {
    syncUiPlugins([]);
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  });

  beforeEach(() => {
    observers.live = 0;
    probes.tokenReads = 0;
    probes.scenes.live = 0;
    probes.scenes.palettes = 0;
    container = dom.document.createElement("div") as unknown as HTMLDivElement;
    dom.document.body.appendChild(container as never);
    root = createRoot(container);
  });

  it("lists every registered renderer", () => {
    expect(Object.keys(CONTRACT).toSorted()).toEqual([...RENDERERS.keys()].toSorted());
  });

  describe.each(Object.keys(CONTRACT))("%s", (key) => {
    const row = CONTRACT[key] ?? { mountable: false, copiesTokens: false, ready: drawn };
    if (!row.mountable) {
      // GAP [[01M3EGV5616VKVV4J76ABC5XX2]]
      it.todo("disposes on switch, re-reads tokens, lets selection beat hover (needs WebGL)");
      return;
    }

    it("leaves nothing behind when another renderer takes the frame", async () => {
      await act(async () => root.render(adapter(key, LIGHT)));
      await until(shownWhen(row.ready));
      await act(async () => root.render(<div data-testid="next" />));
      await settle();
      expect(container.querySelectorAll("svg, canvas, [data-node-id]")).toHaveLength(0);
      expect(observers.live).toBe(0);
      expect(probes.scenes.live).toBe(0);
      act(() => root.unmount());
    });

    it(
      row.copiesTokens
        ? "reads the tokens again when the appearance changes"
        : "copies no token values (it paints live CSS variables)",
      async () => {
        await act(async () => root.render(adapter(key, LIGHT)));
        await until(shownWhen(row.ready));
        const reads = probes.tokenReads + probes.scenes.palettes;
        await act(async () => root.render(adapter(key, DARK)));
        await settle();
        const again = probes.tokenReads + probes.scenes.palettes;
        if (row.copiesTokens) expect(again).toBeGreaterThan(reads);
        else expect(again).toBe(reads);
        act(() => root.unmount());
      },
    );
  });

  // The 3D graph copies its theme's tokens: in every theme it reads them again
  // for a new appearance, and for a new theme.
  describe.each(LENS_THEMES)("force3d in the %s theme", (theme) => {
    it("reads its tokens again for a new appearance and a new theme", async () => {
      await act(async () => root.render(adapter("force3d", LIGHT, null, theme)));
      await until(shownWhen(() => probes.scenes.live > 0));
      const first = probes.scenes.palettes;
      await act(async () => root.render(adapter("force3d", DARK, null, theme)));
      await settle();
      expect(probes.scenes.palettes).toBeGreaterThan(first);
      const other = LENS_THEMES.find((t) => t !== theme) ?? theme;
      const second = probes.scenes.palettes;
      await act(async () => root.render(adapter("force3d", DARK, null, other)));
      await settle();
      expect(probes.scenes.palettes).toBeGreaterThan(second);
      act(() => root.unmount());
    });
  });

  it("tree: a hover does not move the focus off a selection", async () => {
    await act(async () => root.render(adapter("tree", LIGHT, "B")));
    await until(shownWhen(drawn));
    const hovered = container.querySelector('[data-node-id="A"]');
    expect(hovered).not.toBeNull();
    await act(async () => {
      hovered?.dispatchEvent(new dom.PointerEvent("pointerover", { bubbles: true }) as never);
      hovered?.dispatchEvent(new dom.PointerEvent("pointerenter") as never);
    });
    const opacity = (id: string) =>
      Number(container.querySelector(`[data-node-id="${id}"]`)?.getAttribute("opacity") ?? 1);
    // B's neighbourhood stays lit; A's neighbour stays dimmed.
    expect(opacity("D")).toBe(1);
    expect(opacity("C")).toBeLessThan(1);
    act(() => root.unmount());
  });

  it("force3d: a hover does not move the focus off a selection", () => {
    const topology = topologyOf(NODES, EDGES);
    const fades = {
      dim: new EmphasisFade(NODES.length, 0.2),
      glow: new EmphasisFade(NODES.length, 0.2, 0),
      lift: new EmphasisFade(NODES.length, 0.2, 0),
      focus: new EmphasisFade(NODES.length, 0.2, 0),
    };
    setEmphasisTargets(topology, { selectedNodeId: "B" }, "A", fades);
    const at = (id: string) => topology.index.get(id) ?? -1;
    expect(fades.focus.target(at("B"))).toBe(1);
    expect(fades.focus.target(at("A"))).toBe(0);
    expect(fades.dim.target(at("D"))).toBe(1);
    expect(fades.dim.target(at("C"))).toBeLessThan(1);
  });

  it("treemap: has no hover focus to move (selection is its only emphasis)", () => {
    expect(TreemapView.renderer.capabilities.selection).toBe(true);
  });
});
