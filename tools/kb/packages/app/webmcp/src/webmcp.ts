/**
 * The WebMCP surface: the action registry projected onto the page's
 * `document.modelContext` (W3C Web Machine Learning CG, WebMCP draft of
 * 2026-09-29), so an agent driving the browser can call kb's actions as the
 * open page's tools. What it promises is stated once, in DESIGN.md →
 * Surfaces; the surface contract in `@kb/test-kit` proves it.
 *
 * The adapter owns no transport. It lists the registry by invoking
 * `kb.manifest` and runs every tool call through the {@link InvokeAction} its
 * host hands it. In the kb UI that is the browser's one invoke path, which
 * decides whether a call runs on the local replica or on the server.
 */
import { Effect, Predicate } from "effect";
import { z } from "zod";
import {
  ManifestEntrySchema,
  asObjectSchema,
  failed,
  listedOn,
  type ActionInvocation,
  type ActionReceipt,
  type ManifestEntry,
  type SurfaceWire,
} from "@kb/contracts";
import { definePlugin, type Plugin } from "@kb/plugin";

/** WebMCP's `ToolAnnotations`, as far as kb sets them. */
export interface WebMcpToolAnnotations {
  readonly readOnlyHint?: boolean;
  /** Tells the browser or agent to confirm the call with the user first. */
  readonly consequentialHint?: boolean;
}

/** WebMCP's `ModelContextTool` dictionary. */
export interface ModelContextTool {
  /** 1–128 characters from `[A-Za-z0-9_.-]`, so a dotted action id is one as it is. */
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  /** A JSON Schema for the tool's input. */
  readonly inputSchema?: object;
  readonly annotations?: WebMcpToolAnnotations;
  readonly execute: (input: unknown) => Promise<unknown>;
}

/**
 * The part of WebMCP's `ModelContext` the adapter uses. The draft has no
 * `unregisterTool`: a tool is unregistered by aborting the signal it was
 * registered with.
 */
export interface ModelContext {
  registerTool(tool: ModelContextTool, options?: { readonly signal?: AbortSignal }): Promise<void>;
}

/**
 * WebMCP's wire: `execute` receives the tool's input and nothing else, so a
 * call has no envelope for `approved` ({@link listedOn} leaves
 * approval-required actions out). `consequentialHint` asks the agent to
 * confirm a write, but the page never learns whether it did.
 */
export const WEBMCP_WIRE: SurfaceWire = {
  // GAP [GAP-WEBMCP-APPROVAL]
  carriesApproval: false,
};

/** How the host runs an invocation: its receipt, never a throw it can help. */
export type InvokeAction = (invocation: ActionInvocation) => Promise<ActionReceipt>;

/** The action whose output lists the registry this surface projects. */
const MANIFEST_ACTION = "kb.manifest";

const ManifestOutputSchema = z.object({ actions: z.array(ManifestEntrySchema) });

/**
 * `document.modelContext` where the browser has WebMCP, else `undefined`:
 * also where there is no document at all.
 */
export function modelContextOf(document: unknown): ModelContext | undefined {
  if (!Predicate.hasProperty(document, "modelContext")) return undefined;
  const candidate = document.modelContext;
  return isModelContext(candidate) ? candidate : undefined;
}

function isModelContext(value: unknown): value is ModelContext {
  return Predicate.isObject(value) && typeof value.registerTool === "function";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The receipt for an invocation, as a tool result. A receipt the host
 * decorated (the HTTP response's `rev`) is cut back to the receipt, and a host
 * that throws is answered with an `internal` failure, so the agent always gets
 * a receipt.
 */
function receiptFor(
  invoke: InvokeAction,
  invocation: ActionInvocation,
): Effect.Effect<ActionReceipt> {
  return Effect.tryPromise({ try: () => invoke(invocation), catch: messageOf }).pipe(
    Effect.map(
      (receipt): ActionReceipt =>
        receipt.status === "failed"
          ? receipt
          : { status: "succeeded", id: receipt.id, output: receipt.output },
    ),
    Effect.catch((message) => Effect.succeed(failed(invocation.id, "internal", message))),
  );
}

/**
 * One manifest entry as a WebMCP tool. The name is the action id, the hints
 * come from the mode alone: a read is `readOnlyHint`, a write is
 * `consequentialHint`.
 */
export function webMcpTool(entry: ManifestEntry, invoke: InvokeAction): ModelContextTool {
  const reads = entry.mode.kind === "read";
  return {
    name: entry.id,
    title: entry.title,
    description: entry.description,
    inputSchema: asObjectSchema(entry.inputSchema),
    annotations: { readOnlyHint: reads, consequentialHint: !reads },
    execute: (input) => Effect.runPromise(receiptFor(invoke, { id: entry.id, input: input ?? {} })),
  };
}

/** A listener registration: returns its unsubscribe. */
type Subscribe = (listener: () => void) => () => void;

export interface WebMcpOptions {
  /** The page's model context, read once when the adapter starts. */
  readonly modelContext: () => ModelContext | undefined;
  readonly invoke: InvokeAction;
  /**
   * Fires when the registry behind the page may have changed. The adapter
   * lists it again and re-registers only if the listing differs.
   */
  readonly whenManifestMayChange?: Subscribe;
  /** Fires when the page is hidden; every tool is unregistered until the next change. */
  readonly whenPageHides?: Subscribe;
  /** Where the adapter says what it could not do. */
  readonly report?: (message: string) => void;
}

export interface WebMcpAdapter {
  /** Settles once every sync started so far is done. */
  readonly settled: () => Promise<void>;
  /** Unregister every tool and stop listening. */
  readonly stop: () => void;
}

const IDLE: WebMcpAdapter = { settled: () => Promise.resolve(), stop: () => undefined };

/**
 * Register one tool per listed action on the page's model context, and keep
 * them in step with the registry. Every tool of one listing shares one
 * `AbortSignal`; a different listing, a hidden page or {@link WebMcpAdapter.stop}
 * aborts it. Where the page has no model context the adapter does nothing.
 */
export function startWebMcp(options: WebMcpOptions): WebMcpAdapter {
  const modelContext = options.modelContext();
  if (modelContext === undefined) return IDLE;
  const report = options.report ?? (() => undefined);

  let controller: AbortController | null = null;
  /** The listing the live tools were registered from, as JSON. */
  let registered: string | null = null;
  let stopped = false;
  let tail = Promise.resolve();

  const unregister = (): void => {
    controller?.abort();
    controller = null;
    registered = null;
  };

  /** Register the listing under a fresh signal, unless it is the one already live. */
  const register = (listed: readonly ManifestEntry[]): Effect.Effect<void> => {
    const key = JSON.stringify(listed);
    if (key === registered) return Effect.void;
    unregister();
    const next = new AbortController();
    controller = next;
    registered = key;
    return Effect.forEach(
      listed,
      (entry) =>
        Effect.tryPromise({
          try: () =>
            modelContext.registerTool(webMcpTool(entry, options.invoke), { signal: next.signal }),
          catch: messageOf,
        }).pipe(
          Effect.catch((message) =>
            Effect.sync(() => report(`WebMCP did not register ${entry.id}: ${message}`)),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    );
  };

  const syncOnce = Effect.gen(function* () {
    const receipt = yield* receiptFor(options.invoke, { id: MANIFEST_ACTION, input: {} });
    if (stopped) return;
    if (receipt.status === "failed") {
      report(`WebMCP could not list the actions: ${receipt.message}`);
      return;
    }
    const manifest = ManifestOutputSchema.safeParse(receipt.output);
    if (!manifest.success) {
      report(`WebMCP could not read the manifest: ${manifest.error.message}`);
      return;
    }
    yield* register(manifest.data.actions.filter((entry) => listedOn(WEBMCP_WIRE, entry.mode)));
  });

  // One sync at a time, so two listings never register the same name at once;
  // one that failed does not hold up the next.
  const sync = (): void => {
    tail = tail.catch(() => undefined).then(() => Effect.runPromise(syncOnce));
  };

  const unsubscribe = [options.whenManifestMayChange?.(sync), options.whenPageHides?.(unregister)];
  sync();

  return {
    settled: () => tail,
    stop: () => {
      stopped = true;
      for (const off of unsubscribe) off?.();
      unregister();
    },
  };
}

/**
 * The adapter as a plugin: it starts when the plugin loads and unregisters
 * every tool when the plugin unloads, because it lives in the plugin's scope.
 */
export function webMcpPlugin(options: WebMcpOptions): Plugin {
  return definePlugin({
    name: "webmcp",
    apply: () =>
      Effect.asVoid(
        Effect.acquireRelease(
          Effect.sync(() => startWebMcp(options)),
          (adapter) => Effect.sync(adapter.stop),
        ),
      ),
  });
}
