/**
 * The view contract (DESIGN-UI.md → UI points: routes and views), run over
 * every view the built-in and optional UI plugins contribute. A view joins
 * by being registered; a promise one view breaks turns this suite red.
 *
 * R1 checks what a page-placed view must keep: it is found by its key, it
 * mounts in a slot, the slot falls back while its owner is unloaded and
 * brings it back on reload, a throw under its key stays inside the slot, a
 * provider that embeds its own key stops at MAX_VIEW_DEPTH, and unmounting
 * leaves nothing behind. Sizing, disposal, appearance, reduced motion and bad
 * config wait on the host contract: GAP [[01M3EZR20H0CDF5MD01M2S26C5]].
 */
import { Suspense, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Effect } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { definePlugin, makeKernel, type Plugin } from "@kb/plugin";
import { MAX_VIEW_DEPTH, ViewSlot } from "@/components/ui/view-slot";
import { ViewPoint, findView, provideView, syncUiPlugins, type ProvidedView } from "@/lib/plugins";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import { BUILTIN_UI_PLUGINS, OPTIONAL_UI_PLUGINS } from "@/ui-plugins";

const ALL_PLUGINS: readonly Plugin[] = [
  ...BUILTIN_UI_PLUGINS,
  ...OPTIONAL_UI_PLUGINS.map((entry) => entry.plugin),
];

/** Every view the UI can hold, with the plugin that owns it. */
const VIEWS = (() => {
  const kernel = makeKernel();
  Effect.runSync(Effect.forEach(ALL_PLUGINS, (plugin) => kernel.load(plugin)));
  return kernel.contributions(ViewPoint);
})();

const others = (owner: string) => ALL_PLUGINS.filter((plugin) => plugin.name !== owner);

/** A provider under `view`'s own key whose component always throws. */
function throwingStandIn(owner: string, view: ProvidedView): Plugin {
  const Throws = () => {
    throw new Error(`${view.key.id} threw`);
  };
  return definePlugin({
    name: `${owner}.contract-stand-in`,
    namespace: owner,
    apply: (ctx) =>
      ctx.contribute(ViewPoint, provideView(view.key, { ...view, Component: Throws })),
  });
}

/** A provider under `view`'s own key whose component embeds that same key again. */
function selfEmbeddingStandIn(owner: string, view: ProvidedView): Plugin {
  const Embeds = () => (
    <div data-contract-nested="true">
      <ViewSlot
        view={view.key}
        params={view.sample}
        placement="page"
        fallback={<p data-contract-depth-stop="true">stop</p>}
      />
    </div>
  );
  return definePlugin({
    name: `${owner}.contract-self-embed`,
    namespace: owner,
    apply: (ctx) =>
      ctx.contribute(ViewPoint, provideView(view.key, { ...view, Component: Embeds })),
  });
}

const FALLBACK = <p data-contract-fallback="true">fallback</p>;
const SUSPENDED = <p data-contract-suspended="true">loading</p>;

describe("view contract", () => {
  let dom: InstalledDom;
  let container: HTMLElement;
  let root: Root;

  beforeAll(() => {
    dom = installDomGlobals();
    const g = globalThis as Record<string, unknown>;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    g.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  afterAll(() => {
    syncUiPlugins([]);
    dom.restore();
  });

  beforeEach(() => {
    syncUiPlugins(ALL_PLUGINS);
    container = dom.window.document.createElement("div") as unknown as HTMLElement;
    dom.window.document.body.appendChild(container as unknown as never);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** A host that stays up whatever its slot does, and the slot inside it. */
  function mount(view: ProvidedView): void {
    const host: ReactElement = (
      <section data-contract-host="true">
        <Suspense fallback={SUSPENDED}>
          <ViewSlot view={view.key} params={view.sample} placement="page" fallback={FALLBACK} />
        </Suspense>
      </section>
    );
    act(() => root.render(host));
  }

  const shown = (selector: string) => container.querySelector(selector) !== null;

  /** The slot shows the view itself: settled, not the fallback, not an error. */
  function expectViewShown(): void {
    expect(shown("[data-contract-suspended]")).toBe(false);
    expect(shown("[data-contract-fallback]")).toBe(false);
    expect(shown('[data-testid="view-error"]')).toBe(false);
  }

  /**
   * Wait out a lazy page's chunk. A slot that suspended on its first render
   * never committed, so it has not subscribed to the kernel yet; the
   * shell's `WorkspaceBoundary` is one shared loading surface on purpose.
   */
  async function settle(ms = 5000): Promise<void> {
    const deadline = Date.now() + ms;
    while (shown("[data-contract-suspended]") && Date.now() < deadline) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
  }

  it("finds the views it runs over", () => {
    expect(VIEWS.length).toBeGreaterThan(0);
  });

  describe.each(VIEWS.map((view) => ({ id: view.id, owner: view.owner, view: view.value })))(
    "$id",
    ({ owner, view }) => {
      it("is found by its own key", () => {
        expect(findView(VIEWS, view.key)).toBe(view);
      });

      it.each(view.placements)(
        "mounts in a slot at %s, without the fallback or a crash",
        async () => {
          mount(view);
          await settle();
          expectViewShown();
        },
      );

      it("shows the fallback while its owner is unloaded, and comes back on reload", async () => {
        mount(view);
        await settle();
        act(() => syncUiPlugins(others(owner)));
        expect(shown("[data-contract-fallback]")).toBe(true);
        expect(shown("[data-contract-host]")).toBe(true);
        act(() => syncUiPlugins(ALL_PLUGINS));
        await settle();
        expectViewShown();
      });

      it("keeps a throw under its key inside the slot", () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          act(() => syncUiPlugins([...others(owner), throwingStandIn(owner, view)]));
          mount(view);
          expect(shown('[data-testid="view-error"]')).toBe(true);
          expect(shown("[data-contract-host]")).toBe(true);
        } finally {
          quiet.mockRestore();
        }
      });

      it("stops a provider that embeds its own key at the depth limit", () => {
        act(() => syncUiPlugins([...others(owner), selfEmbeddingStandIn(owner, view)]));
        mount(view);
        expect(container.querySelectorAll("[data-contract-nested]")).toHaveLength(MAX_VIEW_DEPTH);
        expect(container.querySelectorAll("[data-contract-depth-stop]")).toHaveLength(1);
        expect(shown('[data-testid="view-error"]')).toBe(false);
      });

      it("leaves nothing behind when it unmounts", async () => {
        const body = dom.window.document.body;
        const before = body.childNodes.length;
        mount(view);
        await settle();
        expectViewShown();
        act(() => root.render(<></>));
        expect(container.childNodes.length).toBe(0);
        // Nothing it portalled or appended outside its box outlives it.
        expect(body.childNodes.length).toBe(before);
      });
    },
  );
});
