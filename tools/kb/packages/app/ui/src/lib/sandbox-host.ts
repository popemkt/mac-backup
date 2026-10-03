/**
 * The kb page as the host of one sandbox frame (DESIGN.md → Sandbox → The
 * frame): the page's end of the MCP Apps bridge. It answers the frame's
 * handshake with the page's theme, hands it the run, and answers each tool
 * call through the capability API (`answerToolCall`: the code's grant, then
 * the invoke core, as the script's). A frame is untrusted: a message is
 * heard only from its own window, is decoded before anything reads it, and a
 * frame that floods the page or loads a second document is cut off.
 */
import { Effect, Result, Schema } from "effect";
import {
  MCP_APPS_METHODS,
  MCP_APPS_VERSION,
  type ActionInvocation,
  type ActionReceipt,
} from "@kb/contracts";
import type { KbNode } from "@kb/model";
import {
  FrameMessage,
  KB_METHODS,
  SANDBOX_THEME_VARIABLES,
  answerToolCall,
  notification,
  resultMessage,
  type LogLevel,
  type RunInput,
  type RunStatus,
} from "@kb/sandbox";
import type { CodeGrant } from "@kb/views";
import { invokeSettled } from "@/session/runtime";

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

/** A hosted frame: tell it the graph changed, or let it go. */
export interface HostedFrame {
  readonly changed: () => void;
  readonly dispose: () => void;
}

/** How many messages a frame may send the page in any one second before it is cut off. */
const FRAME_MESSAGES_PER_SECOND = 400;

const decodeFrameMessage = Schema.decodeUnknownResult(FrameMessage);

/**
 * The browser's one invoke path, for a call made as the script's: a local
 * write answers at once and is pushed after, and the code is told what the
 * server made of the call, never the optimistic first answer.
 */
export async function invokeAsScript(invocation: ActionInvocation): Promise<ActionReceipt> {
  return (await invokeSettled(invocation)).settled;
}

/** The page's design tokens a frame takes, as resolved values. */
function themeVariables(): Record<string, string> {
  const style = window.getComputedStyle(document.documentElement);
  return Object.fromEntries(
    SANDBOX_THEME_VARIABLES.map((name) => [name, style.getPropertyValue(name).trim()]).filter(
      ([, value]) => value !== "",
    ),
  );
}

/** Host `run` in `frame`, an iframe sandboxed with `allow-scripts` alone. */
export function hostSandboxFrame(
  frame: HTMLIFrameElement,
  run: SandboxRun,
  ports: SandboxPorts,
  events: SandboxEvents,
): HostedFrame {
  let initialized = false;
  let open = true;
  let windowStart = performance.now();
  let inWindow = 0;
  const scope = { grant: run.grant, subject: run.input.subject };
  const capability = {
    node: ports.node,
    invoke: (invocation: ActionInvocation) => Effect.promise(() => ports.invoke(invocation)),
  };

  const post = (message: unknown) => {
    if (open) frame.contentWindow?.postMessage(message, "*");
  };

  const cutOff = (message: string) => {
    if (!open) return;
    dispose();
    frame.src = "about:blank";
    events.status({
      state: "ended",
      engine: run.input.engine,
      end: { reason: "error", message },
    });
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    if (!open || event.source !== frame.contentWindow || frame.contentWindow === null) return;
    const now = performance.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      inWindow = 0;
    }
    inWindow += 1;
    if (inWindow > FRAME_MESSAGES_PER_SECOND) {
      cutOff("The frame sent the page too many messages and was cut off.");
      return;
    }
    const decoded = decodeFrameMessage(event.data);
    if (Result.isFailure(decoded)) return;
    const message = decoded.success;
    switch (message.method) {
      case MCP_APPS_METHODS.initialize:
        post(
          resultMessage(message.id, {
            protocolVersion: MCP_APPS_VERSION,
            hostInfo: { name: "kb", version: "1" },
            hostCapabilities: { serverTools: {} },
            hostContext: { styles: { variables: themeVariables() } },
          }),
        );
        break;
      case MCP_APPS_METHODS.initialized:
        initialized = true;
        post(notification(MCP_APPS_METHODS.toolInput, { arguments: run.input }));
        break;
      case MCP_APPS_METHODS.toolsCall: {
        const { id, params } = message;
        void Effect.runPromise(answerToolCall(capability, scope, run.input.limits, params)).then(
          (result) => post(resultMessage(id, result)),
        );
        break;
      }
      case MCP_APPS_METHODS.log:
        events.log(message.params.level, message.params.data);
        break;
      case KB_METHODS.status:
        events.status(message.params);
        break;
      case MCP_APPS_METHODS.sizeChanged:
        // A code view fills the box its host gives it; its size is the host's.
        break;
      default:
        break;
    }
  };

  // The frame's document has loaded by the time it initializes, and no code
  // runs before that. A load after it is the frame navigating itself
  // somewhere: nothing more is sent to whatever is there now.
  const onLoad = () => {
    if (initialized) cutOff("The frame left its document and was cut off.");
  };

  window.addEventListener("message", onMessage);
  frame.addEventListener("load", onLoad);

  function dispose(): void {
    open = false;
    window.removeEventListener("message", onMessage);
    frame.removeEventListener("load", onLoad);
  }

  return {
    changed: () => {
      if (initialized) post(notification(KB_METHODS.event, { type: "data", target: null }));
    },
    dispose,
  };
}
