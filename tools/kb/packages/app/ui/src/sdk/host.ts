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
import type { KbNode, PropValue } from "@kb/model";
import type { KbIndex } from "@/ds";
import type { FollowHow, FollowTarget } from "@/lib/follow";
import type { RefInk } from "@/lib/md-edit";
import { currentService } from "@/lib/plugins";
import type { proposeView } from "@/lib/propose-view";
import type { hostSandboxFrame, invokeAsScript, isTrusted, setTrusted } from "@/lib/sandbox-host";
import type { Appearance } from "@/lib/theme";

export interface BrowserHost {
  /**
   * Listen for any change to what the reads below answer; returns the
   * unsubscribe. Each read returns the same value until what it reads changes.
   */
  readonly subscribe: (listener: () => void) => () => void;
  /** A node of the graph. */
  readonly node: (id: string) => KbNode | undefined;
  /** The replica's index, or null before the graph has loaded. */
  readonly index: () => KbIndex | null;
  /** Whether the live socket is open, so a query subscribes instead of running locally. */
  readonly live: () => boolean;
  readonly appearance: () => Appearance;
  /** How references in rendered text are inked. */
  readonly refInk: () => RefInk;
  /**
   * Carry out a follow from `pane`. `open` opens a node as the page around the
   * caller (`OpenNodeContext`); null means the outline's zoom.
   */
  readonly follow: (
    at: { readonly pane: string; readonly open: ((id: string) => void) | null },
    target: FollowTarget,
    how: FollowHow,
  ) => void;
  /** Send a pane to a path. */
  readonly navigatePane: (pane: string, path: string) => void;
  /** Replace a field's values on a node, through the page's one write path. */
  readonly replaceField: (nodeId: string, fieldId: string, values: PropValue[]) => Promise<void>;
  /** Make a view node through `view.propose`, the one check of a proposed view. */
  readonly proposeView: typeof proposeView;
  /** The page's end of the sandbox bridge (DESIGN.md → Sandbox). */
  readonly sandbox: {
    readonly hostFrame: typeof hostSandboxFrame;
    readonly invokeAsScript: typeof invokeAsScript;
    readonly isTrusted: typeof isTrusted;
    readonly setTrusted: typeof setTrusted;
  };
}

export const BrowserHostService = Service<BrowserHost>()("ui.host");

/** The page's host. Only a plugin that injects `BrowserHostService` may rely on it. */
export function browserHost(): BrowserHost {
  const host = currentService(BrowserHostService);
  if (host === undefined) throw new Error("no BrowserHost: the shell's host plugin is not loaded");
  return host;
}
