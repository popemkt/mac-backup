/**
 * The view contract (DESIGN-UI.md → UI points: routes and views), run over
 * every view the built-in and optional UI plugins contribute. A view joins
 * by being registered; a promise one view breaks turns this suite red.
 *
 * It checks what a view must keep in each placement it offers (a view that
 * offers one is mounted there): it is found by its key, its
 * sample is a legal value of the settings its key declares, it
 * mounts in a slot, the slot falls back while its owner is unloaded and
 * brings it back on reload, a throw under its key stays inside the slot, a
 * provider that embeds its own key stops at MAX_VIEW_DEPTH, and unmounting
 * leaves nothing behind. Sizing, disposal, appearance, reduced motion and bad
 * config wait on the host contract: GAP [[01M3EZR20H0CDF5MD01M2S26C5]].
 */
import { act, use, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Effect, Result, Schema } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { definePlugin, makeKernel, type Plugin, type ContributionEntry } from "@kb/plugin";
import { SYSTEM_IDS, VIEW_FAMILY_VALUES, systemSeedNodes } from "@kb/model";
import { ViewSlot } from "@/components/ui/view-slot";
import { keptLoad } from "@/lib/kept-load";
import {
  ViewPoint,
  findView,
  provideView,
  syncUiPlugins,
  type Placement,
  type ViewProps,
  type ProvidedView,
} from "@/lib/plugins";
import { MAX_VIEW_DEPTH, NoParams, localIdOf, viewKey } from "@/lib/view-key";
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

/** The seeded nodes, by id: where every view's option must be. */
const SEED = new Map(systemSeedNodes().map((node) => [node.id, node]));

const others = (owner: string) => ALL_PLUGINS.filter((plugin) => plugin.name !== owner);

/** `view` again, under its own key and picker, drawn by `Component` instead. */
function standIn(
  view: ProvidedView,
  Component: () => ReactElement,
): ContributionEntry<ProvidedView> {
  return { id: localIdOf(view.key), value: { ...view, Component } };
}

/** A provider under `view`'s own key whose component always throws. */
function throwingStandIn(owner: string, view: ProvidedView): Plugin {
  const Throws = () => {
    throw new Error(`${view.key.id} threw`);
  };
  return definePlugin({
    name: `${owner}.contract-stand-in`,
    namespace: owner,
    apply: (ctx) => ctx.contribute(ViewPoint, standIn(view, Throws)),
  });
}

/** A provider under `view`'s own key whose component embeds that same key again. */
function selfEmbeddingStandIn(owner: string, view: ProvidedView): Plugin {
  const Embeds = () => (
    <div data-contract-nested="true">
      <ViewSlot
        view={view.key}
        params={view.sample}
        placement={firstPlacement(view)}
        fallback={<p data-contract-depth-stop="true">stop</p>}
      />
    </div>
  );
  return definePlugin({
    name: `${owner}.contract-self-embed`,
    namespace: owner,
    apply: (ctx) => ctx.contribute(ViewPoint, standIn(view, Embeds)),
  });
}

/** Where a property that holds whatever the placement is checks a view: the first it offers. */
function firstPlacement(view: ProvidedView): Placement {
  const [placement] = view.placements;
  if (placement === undefined) throw new Error(`${view.key.id} offers no placement`);
  return placement;
}

/** Let effects and promises run until `ready` holds, or fail after a while. */
async function until(ready: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("the slot never settled");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
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
  async function mount(
    view: ProvidedView,
    placement: Placement = firstPlacement(view),
  ): Promise<void> {
    const host: ReactElement = (
      <section data-contract-host="true">
        <ViewSlot
          view={view.key}
          params={view.sample}
          placement={placement}
          fallback={FALLBACK}
          pending={SUSPENDED}
        />
      </section>
    );
    // Awaited, so a view that suspends on its code is retried once that arrives.
    await act(async () => root.render(host));
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

      it("is named in data by a seeded option under sys.views, in its own family", () => {
        const option = SEED.get(view.key.option);
        expect(SEED.get(SYSTEM_IDS.viewsRoot)?.children).toContain(view.key.option);
        const family = option?.props[SYSTEM_IDS.viewFamilyField]?.[0];
        const expected = Object.entries(VIEW_FAMILY_VALUES).find(
          ([name]) => name === view.key.family,
        )?.[1].id;
        if (view.key.family !== undefined) expect(expected).toBeDefined();
        expect(family?.v).toBe(expected);
      });

      it("declares its settings, and its sample is a legal value of them", () => {
        const decoded = Schema.decodeUnknownResult(view.key.params)(view.sample);
        expect(Result.isSuccess(decoded) ? null : decoded.failure.message).toBeNull();
      });

      it.each(view.placements)(
        "mounts in a slot at %s, without the fallback or a crash",
        async (placement) => {
          await mount(view, placement);
          await settle();
          expectViewShown();
        },
      );

      it("shows the fallback while its owner is unloaded, and comes back on reload", async () => {
        await mount(view);
        await settle();
        act(() => syncUiPlugins(others(owner)));
        expect(shown("[data-contract-fallback]")).toBe(true);
        expect(shown("[data-contract-host]")).toBe(true);
        act(() => syncUiPlugins(ALL_PLUGINS));
        await settle();
        expectViewShown();
      });

      it("keeps a throw under its key inside the slot", async () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          act(() => syncUiPlugins([...others(owner), throwingStandIn(owner, view)]));
          await mount(view);
          expect(shown('[data-testid="view-error"]')).toBe(true);
          expect(shown("[data-contract-host]")).toBe(true);
        } finally {
          quiet.mockRestore();
        }
      });

      it("stops a provider that embeds its own key, for the same subject, at the first repeat", async () => {
        act(() => syncUiPlugins([...others(owner), selfEmbeddingStandIn(owner, view)]));
        await mount(view);
        expect(container.querySelectorAll("[data-contract-nested]")).toHaveLength(1);
        expect(container.querySelectorAll("[data-contract-depth-stop]")).toHaveLength(1);
        expect(shown('[data-testid="view-error"]')).toBe(false);
      });

      it("leaves nothing behind when it unmounts", async () => {
        const body = dom.window.document.body;
        const before = body.childNodes.length;
        await mount(view);
        await settle();
        expectViewShown();
        act(() => root.render(<></>));
        expect(container.childNodes.length).toBe(0);
        // Nothing it portalled or appended outside its box outlives it.
        expect(body.childNodes.length).toBe(before);
      });
    },
  );

  describe("the slot", () => {
    const KEY = viewKey("contract.view", NoParams);
    const OTHER = viewKey("contract.other", NoParams);
    const TREE = viewKey("contract.tree", Schema.Struct({ level: Schema.Number }));
    const DEEP = MAX_VIEW_DEPTH + 3;

    /** A view that shows itself again under it, for the next subject, down to `DEEP`. */
    const TreeView = ({ params: { level } }: ViewProps<{ readonly level: number }>) => (
      <div data-contract-level={level}>
        {level < DEEP ? (
          <ViewSlot
            view={TREE}
            params={{ level: level + 1 }}
            placement="page"
            subject={String(level + 1)}
            fallback={<p data-contract-depth-stop="true">stop</p>}
          />
        ) : null}
      </div>
    );

    /** Load `views` beside every UI plugin, under the contract's own namespace. */
    function provide(...views: readonly ContributionEntry<ProvidedView>[]): void {
      act(() =>
        syncUiPlugins([
          ...ALL_PLUGINS,
          definePlugin({
            name: "contract",
            apply: (ctx) =>
              Effect.all(
                views.map((view) => ctx.contribute(ViewPoint, view)),
                { discard: true },
              ),
          }),
        ]),
      );
    }

    it("shows a view again down its own tree, for other subjects, up to MAX_VIEW_DEPTH", () => {
      provide(
        provideView(TREE, { placements: ["page"], sample: { level: 1 }, Component: TreeView }),
      );
      act(() =>
        root.render(
          <ViewSlot
            view={TREE}
            params={{ level: 1 }}
            placement="page"
            subject="1"
            fallback={FALLBACK}
          />,
        ),
      );
      expect(container.querySelectorAll("[data-contract-level]")).toHaveLength(MAX_VIEW_DEPTH);
      expect(container.querySelectorAll("[data-contract-depth-stop]")).toHaveLength(1);
    });

    it("stops a cycle through other views at the first repeat of a view and subject", () => {
      // A for x embeds B for y, which embeds A for x again.
      const A = () => (
        <div data-contract-a="true">
          <ViewSlot
            view={OTHER}
            params={{}}
            placement="page"
            subject="y"
            fallback={<p data-contract-depth-stop="true">stop</p>}
          />
        </div>
      );
      const B = () => (
        <div data-contract-b="true">
          <ViewSlot
            view={KEY}
            params={{}}
            placement="page"
            subject="x"
            fallback={<p data-contract-depth-stop="true">stop</p>}
          />
        </div>
      );
      provide(
        provideView(KEY, { placements: ["page"], sample: {}, Component: A }),
        provideView(OTHER, { placements: ["page"], sample: {}, Component: B }),
      );
      act(() =>
        root.render(
          <ViewSlot view={KEY} params={{}} placement="page" subject="x" fallback={FALLBACK} />,
        ),
      );
      expect(container.querySelectorAll("[data-contract-a]")).toHaveLength(1);
      expect(container.querySelectorAll("[data-contract-b]")).toHaveLength(1);
      expect(container.querySelectorAll("[data-contract-depth-stop]")).toHaveLength(1);
    });

    it("loads a view's code again after a failed load, when its error is retried", async () => {
      // The chunk fails to arrive until the network is back.
      let offline = true;
      const code = keptLoad(async () => {
        if (offline) throw new Error("the chunk did not arrive");
        return "arrived";
      });
      const Loads = () => <p data-contract-loaded="true">{code.current() ?? use(code.load())}</p>;
      provide(provideView(KEY, { placements: ["page"], sample: {}, Component: Loads }));
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await act(async () =>
          root.render(
            <section data-contract-host="true">
              <ViewSlot
                view={KEY}
                params={{}}
                placement="page"
                fallback={FALLBACK}
                pending={SUSPENDED}
              />
            </section>,
          ),
        );
        await until(() => shown('[data-testid="view-error"]'));
        expect(shown("[data-contract-host]")).toBe(true);
        offline = false;
        const retry = container.querySelector('[data-testid="view-error-retry"]');
        await act(async () => (retry as HTMLButtonElement | null)?.click());
        await until(() => shown("[data-contract-loaded]"));
      } finally {
        quiet.mockRestore();
      }
    });

    it("waits for a view that suspends in its own box, and its host stays up", () => {
      const never = new Promise<never>(() => {});
      const Suspends = () => {
        throw never;
      };
      provide(provideView(KEY, { placements: ["page"], sample: {}, Component: Suspends }));
      act(() =>
        root.render(
          <section data-contract-host="true">
            <ViewSlot
              view={KEY}
              params={{}}
              placement="page"
              fallback={FALLBACK}
              pending={SUSPENDED}
            />
          </section>,
        ),
      );
      expect(shown("[data-contract-host]")).toBe(true);
      expect(shown("[data-contract-suspended]")).toBe(true);
    });
  });
});
