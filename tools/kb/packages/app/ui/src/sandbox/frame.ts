/**
 * The sandbox frame's script (DESIGN.md → Sandbox → The frame): the one
 * script the frame document runs, built on its own (`vite.sandbox.config.ts`)
 * into a classic script with no chunk shared with the page. It is an MCP
 * Apps app whose host is the kb page: it initializes, waits for the run's
 * tool input, runs the guest in the engine the page names, draws what the
 * guest draws into its own document, and forwards the guest's tool calls to
 * the page, which alone answers them. It listens to its parent window and to
 * nothing else.
 */
import { Effect, Exit, Result, Schema, Scope } from "effect";
import { JSON_RPC_VERSION, MCP_APPS_METHODS, MCP_APPS_VERSION } from "@kb/contracts";
import {
  KB_METHODS,
  PageMessage,
  SANDBOX_DRAW_ID,
  SANDBOX_STATUS_ID,
  SANDBOX_THEME_VARIABLES,
  ToolResult,
  drawingToDom,
  notification,
  runGuest,
  safeThemeValue,
  type GuestRun,
  type KbEvent,
  type Response,
  type RunInput,
  type RunStatus,
  type SandboxEngine,
} from "@kb/sandbox";
import { quickjsEngine } from "@kb/sandbox-quickjs";
import { workerEngine } from "@kb/sandbox-worker";

// GAP [[01M41DKVB5R21NRCE4T9R4KES1]] QuickJS runs on this frame's main thread, so a
// turn can hold it up to its deadline; running it in a blob Worker inside the
// frame, behind the same engine port, closes it (DESIGN.md → Sandbox → Gaps).
const ENGINES: Readonly<Record<RunInput["engine"], SandboxEngine>> = {
  quickjs: quickjsEngine,
  worker: workerEngine,
};

const drawBox = document.getElementById(SANDBOX_DRAW_ID);
const statusBox = document.getElementById(SANDBOX_STATUS_ID);
const host = window.parent;

function say(text: string): void {
  if (statusBox === null) return;
  statusBox.textContent = text;
  statusBox.hidden = text === "";
}

function send(message: unknown): void {
  host.postMessage(message, "*");
}

let nextId = 0;
const waiting = new Map<number | string, (response: Response) => void>();

/** A request to the page, answered by its response. */
function request(method: string, params: unknown): Promise<Response> {
  nextId += 1;
  const id = nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    send({ jsonrpc: JSON_RPC_VERSION, id, method, params });
  });
}

const decodePageMessage = Schema.decodeUnknownResult(PageMessage);
const decodeToolResult = Schema.decodeUnknownResult(ToolResult);
const HostContext = Schema.Struct({
  hostContext: Schema.optionalKey(
    Schema.Struct({
      styles: Schema.optionalKey(
        Schema.Struct({ variables: Schema.Record(Schema.String, Schema.String) }),
      ),
    }),
  ),
});
const decodeHostContext = Schema.decodeUnknownResult(HostContext);

/** The page's theme as this document's CSS variables, the known names and safe values only. */
function applyTheme(result: unknown): void {
  const decoded = decodeHostContext(result);
  if (Result.isFailure(decoded)) return;
  const variables = decoded.success.hostContext?.styles?.variables ?? {};
  const known: ReadonlySet<string> = new Set(SANDBOX_THEME_VARIABLES);
  for (const [name, value] of Object.entries(variables)) {
    if (known.has(name) && safeThemeValue(value)) {
      document.documentElement.style.setProperty(name, value);
    }
  }
}

/** The tool result a page's response carries, or an error result when it carries none. */
function toolResultOf(response: Response): ToolResult {
  if ("result" in response) {
    const decoded = decodeToolResult(response.result);
    if (Result.isSuccess(decoded)) return decoded.success;
  }
  const message = "error" in response ? response.error.message : "the page sent no result";
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code: "internal", message }) }],
  };
}

function status(params: RunStatus): void {
  send(notification(KB_METHODS.status, params));
}

let run: { readonly guest: GuestRun; readonly scope: Scope.Closeable } | null = null;

function stopRun(): void {
  const current = run;
  run = null;
  if (current !== null) Effect.runFork(Scope.close(current.scope, Exit.void));
}

let sizeFrame = 0;
/** Tell the page the drawing's height, once per frame at most. */
function reportSize(): void {
  if (sizeFrame !== 0) return;
  sizeFrame = requestAnimationFrame(() => {
    sizeFrame = 0;
    const { scrollWidth: width, scrollHeight: height } = document.documentElement;
    send(notification(MCP_APPS_METHODS.sizeChanged, { width, height }));
  });
}

let generation = 0;

function start(input: RunInput): void {
  stopRun();
  say("");
  drawBox?.replaceChildren();
  generation += 1;
  const mine = generation;
  const scope = Effect.runSync(Scope.make());
  const started = Scope.provide(scope)(
    runGuest(
      ENGINES[input.engine],
      { code: input.code, subject: input.subject, limits: input.limits },
      {
        draw: (report) =>
          Effect.sync(() => {
            if (mine !== generation) return;
            drawBox?.replaceChildren(...drawingToDom(document, report.nodes));
            reportSize();
          }),
        log: (level, data) =>
          Effect.sync(() => send(notification(MCP_APPS_METHODS.log, { level, data }))),
        callTool: (call) =>
          Effect.map(
            Effect.promise(() => request(MCP_APPS_METHODS.toolsCall, call)),
            toolResultOf,
          ),
      },
    ),
  );
  void Effect.runPromise(started).then((guest) => {
    if (mine !== generation) {
      Effect.runFork(Scope.close(scope, Exit.void));
      return;
    }
    run = { guest, scope };
    status({ state: "running", engine: input.engine });
    Effect.runFork(
      Effect.map(guest.ended, (end) => {
        if (run?.guest !== guest) return;
        say(end.message);
        reportSize();
        status({ state: "ended", engine: input.engine, end });
      }),
    );
  });
}

/** A gesture on what the guest drew, as the event its handlers get. */
function gesture(event: Event): KbEvent | null {
  if (event.type !== "click" && event.type !== "input" && event.type !== "change") return null;
  const target = event.target instanceof Element ? event.target : null;
  if (target === null || drawBox === null || !drawBox.contains(target)) return null;
  const named = target.closest("[id]");
  const id = named !== null && drawBox.contains(named) ? named.id : null;
  if (
    target instanceof HTMLInputElement &&
    (target.type === "checkbox" || target.type === "radio")
  ) {
    return { type: event.type, target: id, value: target.checked };
  }
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return { type: event.type, target: id, value: target.value };
  }
  return { type: event.type, target: id };
}

for (const type of ["click", "input", "change"]) {
  drawBox?.addEventListener(type, (event) => {
    const kbEvent = gesture(event);
    const current = run;
    if (kbEvent !== null && current !== null) Effect.runFork(current.guest.event(kbEvent));
  });
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== host) return;
  const decoded = decodePageMessage(event.data);
  if (Result.isFailure(decoded)) return;
  const message = decoded.success;
  if ("id" in message) {
    const resolve = waiting.get(message.id);
    waiting.delete(message.id);
    resolve?.(message);
  } else if (message.method === MCP_APPS_METHODS.toolInput) {
    start(message.params.arguments);
  } else {
    const current = run;
    if (current !== null) Effect.runFork(current.guest.event(message.params));
  }
});

new ResizeObserver(reportSize).observe(document.documentElement);

if (host === window) {
  say("This page runs code only inside kb.");
} else {
  void request(MCP_APPS_METHODS.initialize, {
    protocolVersion: MCP_APPS_VERSION,
    appInfo: { name: "kb-sandbox", version: "1" },
    appCapabilities: { availableDisplayModes: ["inline"] },
  }).then((response) => {
    if ("result" in response) applyTheme(response.result);
    send({ jsonrpc: JSON_RPC_VERSION, method: MCP_APPS_METHODS.initialized });
  });
}
