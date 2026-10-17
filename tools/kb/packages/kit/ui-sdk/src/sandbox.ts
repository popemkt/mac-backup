/**
 * The page's end of the sandbox bridge, as a feature sees it (DESIGN.md →
 * Sandbox → The frame): the run a frame hosts, what the page gives it, what
 * it tells the page, and the handle the page keeps. The shell hosts frames
 * (`lib/sandbox-host.ts`) and hands that host to a feature through
 * `BrowserHost.sandbox`.
 */
import type { ActionInvocation, ActionReceipt } from "@kb/contracts";
import type { KbNode } from "@kb/model";
import type {
  CodeGrant,
  KbEvent,
  LogLevel,
  RunInput,
  RunStatus,
  SandboxAnchors,
} from "@kb/sandbox";

/** One run a frame hosts: what it runs, and what its code may ask. */
export interface SandboxRun {
  readonly input: RunInput;
  readonly grant: CodeGrant;
}

/** What the page gives the frame: nodes for the grant's scope, and the invoke path. */
export interface SandboxPorts {
  readonly node: (id: string) => KbNode | undefined;
  /** Make one call as the script's and answer the server's receipt. */
  readonly invoke: (invocation: ActionInvocation) => Promise<ActionReceipt>;
}

/** What the frame tells the page. */
export interface SandboxEvents {
  readonly status: (status: RunStatus) => void;
  readonly log: (level: LogLevel, text: string) => void;
}

/** A hosted frame: hand its run an event (the graph changed, a view's own), or let it go. */
export interface HostedFrame {
  /** Tell the run `event`; it hears only the types its run declares (`RunInput.events`). */
  readonly event: (event: KbEvent) => void;
  /** Tell the frame where its view draws its things now: what its anchored drawings stand on. */
  readonly anchor: (anchors: SandboxAnchors) => void;
  readonly dispose: () => void;
}
