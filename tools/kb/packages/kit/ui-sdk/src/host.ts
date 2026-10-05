/**
 * `BrowserHost`: what a feature's UI reaches of the shell (DESIGN-UI.md →
 * Extension UI halves). The shell provides it to the UI kernel
 * (`src/browser-host.ts`), and a feature plugin injects it, so the plugin
 * waits as pending until the shell has provided it. This module names the
 * shape and never imports a store.
 *
 * It holds no React hooks. It is a source to subscribe to, reads of what
 * that source holds now, and gestures. A hook that crosses a plugin boundary
 * would be selected at run time, which React cannot check. So the sdk's own
 * hooks (`sdk/hooks.ts`) are built over these reads, once, with
 * `useSyncExternalStore`.
 */
import { Service } from "@kb/plugin";
import type { PropValue } from "@kb/model";
import type { ActionInvocation, ActionReceipt, WireNode } from "@kb/contracts";
import type { ViewKey } from "@kb/views";
import type { NodeTextPort } from "./components/node-text-port";
import type { RefInk } from "./lib/md-edit";
import type { PaneScreenPort } from "./lib/pane-screen";
import { currentService } from "./lib/plugins";
import type { Appearance, ThemePref } from "./lib/theme";
import type { OutlineNode } from "./lib/types";
import type { QueryRowsSubscribe } from "./lib/use-query-node-rows";
import type { HostedFrame, SandboxEvents, SandboxPorts, SandboxRun } from "./sandbox";

/** A view node to make from settings: what `view.propose` checks. */
export interface ViewProposal {
  readonly view: ViewKey<unknown>;
  readonly params: Readonly<Record<string, unknown>>;
  /** The node it is shown for, which names it among its views. */
  readonly host?: string;
  readonly text?: string;
}

/** The new view node's id, or the receipt's message when the proposal was refused. */
export type ProposedView = { readonly id: string } | { readonly refused: string };

/**
 * The page's host. It is a node text port too (`NodeTextPort`): the graph
 * reads, the caret hand-off, the text-host registry and the gestures a node
 * text host makes, so a half binds a text host through it
 * (`useNodeTextBinding`) as the shell binds its own through its stores.
 */
export interface BrowserHost extends NodeTextPort {
  /** A node of the graph, as the outline holds it. */
  readonly node: (id: string) => OutlineNode | undefined;
  /** Whether a node is being edited in this instance (`instanceKey`). */
  readonly isActive: (nodeId: string, instanceKey: string) => boolean;
  /** The graph's nodes as they came over the wire. */
  readonly wireNodes: () => WireNode[];
  /** Whether the live socket is open, so a query subscribes instead of running locally. */
  readonly live: () => boolean;
  /** Subscribe a query node's rows over the live socket, as one subscriber; returns the unsubscribe. */
  readonly subscribeQuery: QueryRowsSubscribe;
  readonly appearance: () => Appearance;
  readonly theme: () => ThemePref;
  readonly prefsOpen: () => boolean;
  readonly setPrefsOpen: (open: boolean) => void;
  /** Whether the left rail is open, at a narrow or a wide viewport. */
  readonly sidebarOpen: (narrow: boolean) => boolean;
  /** Toggle the left rail from its button, drawn with the rail `open`; focus returns to it. */
  readonly toggleSidebar: (
    narrow: boolean,
    open: boolean,
    button: HTMLButtonElement | null,
  ) => void;
  /** How references in rendered text are inked. */
  readonly refInk: () => RefInk;
  /** Zoom the outline to a node. */
  readonly zoomTo: (id: string) => void;
  /** Start editing a node's text in one instance, with the caret at `cursorPos`. */
  readonly activateNode: (nodeId: string, cursorPos?: number, instanceKey?: string) => void;
  /** Send a pane to a path. */
  readonly navigatePane: (pane: string, path: string) => void;
  /** Replace a field's values on a node, through the page's one write path. */
  readonly replaceField: (nodeId: string, fieldId: string, values: PropValue[]) => Promise<void>;
  /** Set a node's text, through the page's one write path. */
  readonly updateNodeContent: (nodeId: string, text: string) => Promise<void>;
  /**
   * Store a file as an asset through `asset.upload`; the `assets/…` path it
   * is referenced by (markdown's `![](assets/…)`, a canvas image's `file`),
   * or null when it could not be stored (the page has said why).
   */
  readonly uploadAsset: (file: File) => Promise<string | null>;
  /** Attach a file to a node (`uploadAsset`, then a markdown reference); false when it could not be attached. */
  readonly attachFileToNode: (nodeId: string, file: File) => Promise<boolean>;
  /** Take a tag off a node. */
  readonly removeTag: (nodeId: string, tagId: string) => Promise<void>;
  /** Make one call through the browser's one invoke path and answer its receipt. */
  readonly invoke: (id: string, input: unknown) => Promise<ActionReceipt>;
  /** Where a view reports what it shows for its pane (`usePaneScreen`). */
  readonly screen: PaneScreenPort;
  /** Make a view node through `view.propose`, the one check of a proposed view. */
  readonly proposeView: (proposal: ViewProposal) => Promise<ProposedView>;
  /** The page's end of the sandbox bridge (DESIGN.md → Sandbox). */
  readonly sandbox: {
    /** Host `run` in `frame`, an iframe sandboxed with `allow-scripts` alone. */
    readonly hostFrame: (
      frame: HTMLIFrameElement,
      run: SandboxRun,
      ports: SandboxPorts,
      events: SandboxEvents,
    ) => HostedFrame;
    /** Make one call as the script's, answered with what the server made of it. */
    readonly invokeAsScript: (invocation: ActionInvocation) => Promise<ActionReceipt>;
    /** Whether a person has trusted the code with `digest` on this machine. */
    readonly isTrusted: (digest: string) => Promise<boolean>;
    /** Trust, or stop trusting, the code with `digest`: the person's own gesture. */
    readonly setTrusted: (digest: string, trusted: boolean) => Promise<ActionReceipt>;
  };
}

export const BrowserHostService = Service<BrowserHost>()("ui.host");

/** The page's host. Only a plugin that injects `BrowserHostService` may rely on it. */
export function browserHost(): BrowserHost {
  const host = currentService(BrowserHostService);
  if (host === undefined) throw new Error("no BrowserHost: the shell's host plugin is not loaded");
  return host;
}
