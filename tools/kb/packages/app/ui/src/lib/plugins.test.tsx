/**
 * `syncUiPlugins` converges the one UI kernel on a list, and a component
 * reading a point sees the change live — the property that lets a preference
 * unload a plugin without a page reload.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { definePlugin, type Plugin } from "@kb/plugin";
import { installDomGlobals, type InstalledDom } from "@/test-support/dom-globals";
import {
  RoutePoint,
  SidebarSectionPoint,
  ViewPoint,
  provideRoute,
  provideView,
  syncUiPlugins,
  useContributions,
  viewKey,
  type NoParams,
} from "./plugins";

const Nothing = () => null;

/** A plugin contributing one view, the route to it at `/<name>`, and one sidebar section. */
function pagePlugin(name: string): Plugin {
  const view = viewKey<NoParams>()(`${name}.page`);
  return definePlugin({
    name,
    apply: (ctx) =>
      Effect.all(
        [
          ctx.contribute(
            ViewPoint,
            provideView(view, { placements: ["page"], Component: Nothing }),
          ),
          ctx.contribute(
            RoutePoint,
            provideRoute({
              view,
              match: (path) => (path === `/${name}` ? {} : null),
              frame: () => "full",
              pendingTitle: () => name,
            }),
          ),
          ctx.contribute(SidebarSectionPoint, {
            id: "section",
            value: { order: 0, Component: Nothing },
          }),
        ],
        { discard: true },
      ),
  });
}

const failing = definePlugin({
  name: "broken",
  apply: () => Effect.die(new Error("no")),
});

function Sections() {
  const sections = useContributions(SidebarSectionPoint);
  return createElement(
    "ul",
    null,
    ...sections.map((s) => createElement("li", { key: s.id }, s.id)),
  );
}

describe("syncUiPlugins", () => {
  let dom: InstalledDom;
  let root: Root;
  let container: HTMLElement;

  beforeAll(() => {
    dom = installDomGlobals();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = dom.window.document.createElement("div") as unknown as HTMLElement;
    root = createRoot(container);
    act(() => root.render(createElement(Sections)));
  });

  afterAll(() => {
    act(() => root.unmount());
    syncUiPlugins([]);
    dom.restore();
  });

  const listed = () => [...container.querySelectorAll("li")].map((li) => li.textContent);

  it("loads what is listed and unloads what is not, live", () => {
    const a = pagePlugin("a");
    const b = pagePlugin("b");
    act(() => syncUiPlugins([a, b]));
    expect(listed()).toEqual(["a.section", "b.section"]);
    act(() => syncUiPlugins([a]));
    expect(listed()).toEqual(["a.section"]);
    act(() => syncUiPlugins([a, b]));
    expect(listed()).toEqual(["a.section", "b.section"]);
  });

  it("keeps the rest loading when one plugin fails, and can drop the failure", () => {
    const a = pagePlugin("a");
    act(() => syncUiPlugins([failing, a]));
    expect(listed()).toEqual(["a.section"]);
    act(() => syncUiPlugins([a]));
    expect(listed()).toEqual(["a.section"]);
  });
});
