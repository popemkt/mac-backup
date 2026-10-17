/**
 * The scripts host runs what a view's subjects name: a trusted script on
 * the page's sandbox runner, with its node as the subject and the view's
 * events, its frame over the view standing its drawing on the view's
 * anchors, and an untrusted one not at all.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CODE_IDS } from "@kb/code";
import { succeeded } from "@kb/contracts";
import { SYSTEM_IDS, canonicalJson } from "@kb/model";
import { codeDigest, type KbEvent, type SandboxAnchors } from "@kb/sandbox";
import {
  createViewLayout,
  createViewEvents,
  syncUiPlugins,
  type HostedFrame,
  type OutlineNode,
  type SandboxRun,
} from "@kb/ui-sdk";
import { NoParams, viewKey } from "@kb/views";
import {
  installDomGlobals,
  testBrowserHost,
  testHostPlugin,
  type InstalledDom,
} from "@kb/ui-test-kit";
import { ScriptsHost } from "./scripts-host";

const View = viewKey("t.view", "A view", NoParams, undefined, { events: ["t.ping"] });
const GRANT = { reads: "subject" as const, actions: [] };
const TRUSTED = "kb.on('t.ping', () => {});";
const UNTRUSTED = "kb.draw('never');";

const node = (id: string, text: string, props: OutlineNode["props"]): OutlineNode => ({
  id,
  text,
  parentId: null,
  children: [],
  collapsed: false,
  props,
  tags: [],
  createdAt: "",
  updatedAt: "",
});
const script = (id: string, code: string) =>
  node(id, id, {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: CODE_IDS.scriptTag }],
    [CODE_IDS.codeField]: [{ t: "str", v: code }],
    [CODE_IDS.codeGrantField]: [{ t: "str", v: canonicalJson(GRANT) }],
  });

let dom: InstalledDom;
let root: Root;
let container: HTMLElement;
beforeEach(() => {
  dom = installDomGlobals();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  syncUiPlugins([]);
  dom.restore();
});

describe("the scripts host", () => {
  test("runs a trusted script for its subject with the view's events; never an untrusted one", async () => {
    const trusted = await Effect.runPromise(codeDigest(TRUSTED, GRANT));
    const runs: SandboxRun[] = [];
    const heard: KbEvent[] = [];
    const placed: SandboxAnchors[] = [];
    const frames: HTMLIFrameElement[] = [];
    const invoked: [string, unknown][] = [];
    const host = testBrowserHost({
      invoke: (id, input) => {
        invoked.push([id, input]);
        return Promise.resolve(succeeded(id, {}));
      },
      sandbox: {
        hostFrame: (frame, run): HostedFrame => {
          runs.push(run);
          frames.push(frame);
          return {
            event: (event) => heard.push(event),
            anchor: (anchors) => placed.push(anchors),
            dispose: () => {},
          };
        },
        invokeAsScript: () => Promise.reject(new Error("no calls")),
        isTrusted: (digest) => Promise.resolve(digest === trusted),
        setTrusted: () => Promise.reject(new Error("no trust")),
      },
    });
    host.setNodes([
      node("c", "Board", {
        [CODE_IDS.scriptsField]: [
          { t: "ref", v: "s.trusted" },
          { t: "ref", v: "s.untrusted" },
        ],
      }),
      script("s.trusted", TRUSTED),
      script("s.untrusted", UNTRUSTED),
    ]);
    act(() => syncUiPlugins([testHostPlugin(host)]));
    const events = createViewEvents();
    const layout = createViewLayout();
    const here = { left: 1, top: 2, right: 30, bottom: 40 };
    layout.set({ anchors: { a: here } });
    await act(async () => {
      root.render(createElement(ScriptsHost, { subjects: ["c"], view: View, events, layout }));
    });
    await act(async () => new Promise((done) => setTimeout(done, 20)));

    expect(runs.map((run) => run.input)).toEqual([
      expect.objectContaining({
        code: TRUSTED,
        subject: "c",
        events: ["t.ping"],
        engine: "worker",
      }),
    ]);
    const rows = [...container.querySelectorAll("[data-script]")];
    expect(rows.map((row) => row.getAttribute("data-script-trust"))).toEqual([
      "trusted",
      "untrusted",
    ]);
    expect(rows[1]?.textContent).toContain("Not trusted");

    events.emit({ type: "t.ping", target: null });
    expect(heard).toEqual([{ type: "t.ping", target: null }]);

    // Its frame lies over the view, letting gestures pass, and stands its drawing where the view's things are now.
    expect(frames[0]?.closest("[data-script-overlays]")).not.toBeNull();
    expect(frames[0]?.className).toContain("pointer-events-none");
    expect(placed).toEqual([{ a: here }]);
    layout.set({ anchors: {} });
    expect(placed).toEqual([{ a: here }, {}]);

    // A person runs a trusted script once more, against its node; an untrusted one offers no run.
    const runOnce = [...container.querySelectorAll("button")].filter(
      (button) => button.textContent === "Run once",
    );
    expect(runOnce).toHaveLength(1);
    await act(async () => {
      runOnce[0]?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(invoked).toEqual([["ext.code.script.run", { script: "s.trusted", subject: "c" }]]);
  });

  test("a view whose subjects name no scripts shows nothing", async () => {
    const host = testBrowserHost();
    host.setNodes([node("c", "Board", {})]);
    act(() => syncUiPlugins([testHostPlugin(host)]));
    await act(async () => {
      root.render(
        createElement(ScriptsHost, {
          subjects: ["c"],
          view: View,
          events: createViewEvents(),
          layout: createViewLayout(),
        }),
      );
    });
    expect(container.innerHTML).toBe("");
  });
});
