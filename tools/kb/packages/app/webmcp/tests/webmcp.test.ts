/**
 * The WebMCP adapter's lifecycle: when it registers, when it unregisters, and
 * what a tool call returns. What it lists and answers for the real registry
 * is the surface contract's business (`packages/app/cli/tests/surface-contract.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  failed,
  type ActionInvocation,
  type ActionReceipt,
  type ManifestEntry,
} from "@kb/contracts";
import { makeKernel } from "@kb/plugin";
import { FakeModelContext } from "@kb/test-kit";
import {
  ToolCallFailed,
  modelContextOf,
  startWebMcp,
  webMcpPlugin,
  webMcpTool,
  type ModelContext,
  type WebMcpOptions,
} from "../src/index.ts";

function entry(id: string, mode: ManifestEntry["mode"]): ManifestEntry {
  return {
    id,
    title: id,
    description: `${id} description`,
    mode,
    inputSchema: { type: "object", properties: {} },
    outputSchema: {},
  };
}

const READ = entry("node.get", { kind: "read" });
const WRITE = entry("node.update", { kind: "write" });
const GATED = entry("ext.gated.stamp", { kind: "write", approval: "required" });

/** A host whose registry is `actions` and which records every call. */
function host(initial: readonly ManifestEntry[]) {
  let actions = initial;
  const calls: ActionInvocation[] = [];
  const invoke = (invocation: ActionInvocation): Promise<ActionReceipt> => {
    calls.push(invocation);
    if (invocation.id === "kb.manifest") {
      return Promise.resolve({ status: "succeeded", id: invocation.id, output: { actions } });
    }
    return Promise.resolve({ status: "succeeded", id: invocation.id, output: invocation.input });
  };
  return {
    calls,
    invoke,
    setActions: (next: readonly ManifestEntry[]) => {
      actions = next;
    },
  };
}

/** A listener slot the test fires by hand, standing in for a browser event. */
function trigger() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    fire: () => {
      for (const listener of listeners) listener();
    },
    size: () => listeners.size,
  };
}

const names = (page: FakeModelContext) => page.tools().map((tool) => tool.name);

describe("WebMCP adapter", () => {
  test("does nothing where the page has no model context", async () => {
    const kb = host([READ]);
    const adapter = startWebMcp({ modelContext: () => modelContextOf({}), invoke: kb.invoke });
    await adapter.settled();
    expect(kb.calls).toEqual([]);
  });

  test("finds a model context on the document", () => {
    const page = new FakeModelContext();
    expect(modelContextOf({ modelContext: page })).toBe(page);
    expect(modelContextOf({ modelContext: {} })).toBeUndefined();
  });

  test("registers one tool per listed action, named by its id and hinted by its mode", async () => {
    const page = new FakeModelContext();
    const kb = host([READ, WRITE, GATED]);
    await startWebMcp({ modelContext: () => page, invoke: kb.invoke }).settled();
    expect(
      page.tools().map(({ name, title, description, inputSchema, annotations }) => ({
        name,
        title,
        description,
        inputSchema,
        annotations,
      })),
    ).toEqual([
      {
        name: "node.get",
        title: "node.get",
        description: "node.get description",
        inputSchema: READ.inputSchema as object,
        annotations: { readOnlyHint: true, consequentialHint: false },
      },
      {
        name: "node.update",
        title: "node.update",
        description: "node.update description",
        inputSchema: WRITE.inputSchema as object,
        annotations: { readOnlyHint: false, consequentialHint: true },
      },
    ]);
  });

  test("a call goes through the host's invoke and returns the bare receipt", async () => {
    const page = new FakeModelContext();
    const invoke = (invocation: ActionInvocation): Promise<ActionReceipt> =>
      invocation.id === "kb.manifest"
        ? Promise.resolve({ status: "succeeded", id: invocation.id, output: { actions: [WRITE] } })
        : // The browser's server lane answers with the HTTP response, rev and all.
          Promise.resolve({ status: "succeeded", id: invocation.id, output: 1, rev: 7 });
    await startWebMcp({ modelContext: () => page, invoke }).settled();
    expect(await page.tool("node.update")?.execute({ id: "n" })).toEqual({
      status: "succeeded",
      id: "node.update",
      output: 1,
    });
  });

  test("a receipt that did not succeed is the tool's error, carrying the receipt", async () => {
    const page = new FakeModelContext();
    const invoke = (invocation: ActionInvocation): Promise<ActionReceipt> =>
      invocation.id === "kb.manifest"
        ? Promise.resolve({ status: "succeeded", id: invocation.id, output: { actions: [WRITE] } })
        : Promise.resolve(failed(invocation.id, "not_found", "no such node"));
    await startWebMcp({ modelContext: () => page, invoke }).settled();
    const error = await page
      .tool("node.update")
      ?.execute({ id: "n" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolCallFailed);
    expect((error as ToolCallFailed).message).toBe("no such node");
    expect((error as ToolCallFailed).receipt).toMatchObject({
      status: "failed",
      id: "node.update",
      code: "not_found",
    });
  });

  test("a host that throws is answered with an internal failure, as the tool's error", async () => {
    const page = new FakeModelContext();
    const invoke = (invocation: ActionInvocation): Promise<ActionReceipt> =>
      invocation.id === "kb.manifest"
        ? Promise.resolve({ status: "succeeded", id: invocation.id, output: { actions: [READ] } })
        : Promise.reject(new Error("network down"));
    await startWebMcp({ modelContext: () => page, invoke }).settled();
    const error = await page
      .tool("node.get")
      ?.execute(undefined)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolCallFailed);
    expect((error as ToolCallFailed).receipt).toMatchObject({
      status: "failed",
      id: "node.get",
      code: "internal",
      message: "network down",
    });
  });

  test("the input reaches the host as it was given, as an agent's call", async () => {
    const kb = host([READ]);
    const page = new FakeModelContext();
    await startWebMcp({ modelContext: () => page, invoke: kb.invoke }).settled();
    await page.tool("node.get")?.execute(undefined);
    expect(kb.calls.at(-1)).toEqual({ id: "node.get", input: undefined, actor: "agent" });
  });

  test("publishes the object schema MCP publishes, whatever the action declares", () => {
    const tool = webMcpTool({ ...READ, inputSchema: { type: "string" } }, host([]).invoke);
    expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
  });

  test("re-registers when the listing changes, and only then", async () => {
    const page = new FakeModelContext();
    const kb = host([READ]);
    const changes = trigger();
    const adapter = startWebMcp({
      modelContext: () => page,
      invoke: kb.invoke,
      whenManifestMayChange: changes.subscribe,
    });
    await adapter.settled();
    const first = page.tool("node.get");

    changes.fire();
    await adapter.settled();
    expect(page.tool("node.get")).toBe(first);

    kb.setActions([READ, WRITE]);
    changes.fire();
    await adapter.settled();
    expect(names(page)).toEqual(["node.get", "node.update"]);
    expect(page.tool("node.get")).not.toBe(first);
  });

  test("a hidden page unregisters every tool until the listing is read again", async () => {
    const page = new FakeModelContext();
    const kb = host([READ]);
    const changes = trigger();
    const hides = trigger();
    const adapter = startWebMcp({
      modelContext: () => page,
      invoke: kb.invoke,
      whenManifestMayChange: changes.subscribe,
      whenPageHides: hides.subscribe,
    });
    await adapter.settled();
    hides.fire();
    expect(names(page)).toEqual([]);
    changes.fire();
    await adapter.settled();
    expect(names(page)).toEqual(["node.get"]);
  });

  test("stopping unregisters every tool and every listener", async () => {
    const page = new FakeModelContext();
    const changes = trigger();
    const adapter = startWebMcp({
      modelContext: () => page,
      invoke: host([READ, WRITE]).invoke,
      whenManifestMayChange: changes.subscribe,
    });
    await adapter.settled();
    adapter.stop();
    expect(names(page)).toEqual([]);
    expect(changes.size()).toBe(0);
  });

  test("reports a tool the browser refuses and registers the rest", async () => {
    const page = new FakeModelContext();
    const reports: string[] = [];
    const options: WebMcpOptions = {
      modelContext: () => page,
      invoke: host([READ, entry("bad name", { kind: "read" })]).invoke,
      report: (message) => reports.push(message),
    };
    await startWebMcp(options).settled();
    expect(names(page)).toEqual(["node.get"]);
    expect(reports).toEqual(["WebMCP did not register bad name: invalid tool name: bad name"]);
  });

  test("a listing with a refused tool is not live, so the next sync registers it again", async () => {
    const page = new FakeModelContext();
    const reports: string[] = [];
    const kb = host([READ, entry("bad name", { kind: "read" })]);
    const changes = trigger();
    const adapter = startWebMcp({
      modelContext: () => page,
      invoke: kb.invoke,
      whenManifestMayChange: changes.subscribe,
      report: (message) => reports.push(message),
    });
    await adapter.settled();
    const first = page.tool("node.get");
    changes.fire();
    await adapter.settled();
    expect(reports).toHaveLength(2);
    expect(names(page)).toEqual(["node.get"]);
    expect(page.tool("node.get")).not.toBe(first);
  });

  test("a registration cancelled by its own signal is not reported", async () => {
    const reports: string[] = [];
    const cancelled: ModelContext = {
      registerTool: () => Promise.reject(new DOMException("aborted", "AbortError")),
    };
    await startWebMcp({
      modelContext: () => cancelled,
      invoke: host([READ]).invoke,
      report: (message) => reports.push(message),
    }).settled();
    expect(reports).toEqual([]);
  });

  test("like a browser, the model context refuses a registration whose signal has aborted", async () => {
    const page = new FakeModelContext();
    const controller = new AbortController();
    controller.abort();
    const rejection = await page
      .registerTool(webMcpTool(READ, host([]).invoke), { signal: controller.signal })
      .catch((e: unknown) => e);
    expect((rejection as DOMException).name).toBe("AbortError");
    expect(names(page)).toEqual([]);
  });

  test("a listing that arrives after the page hid registers nothing; a restored page does", async () => {
    const page = new FakeModelContext();
    const changes = trigger();
    const hides = trigger();
    const gate = Promise.withResolvers<void>();
    const kb = host([READ]);
    const adapter = startWebMcp({
      modelContext: () => page,
      invoke: async (invocation) => {
        if (invocation.id === "kb.manifest") await gate.promise;
        return kb.invoke(invocation);
      },
      whenManifestMayChange: changes.subscribe,
      whenPageHides: hides.subscribe,
    });
    hides.fire();
    gate.resolve();
    await adapter.settled();
    expect(names(page)).toEqual([]);
    changes.fire();
    await adapter.settled();
    expect(names(page)).toEqual(["node.get"]);
  });

  test("as a plugin, it registers on load and unregisters on unload", async () => {
    const page = new FakeModelContext();
    const kernel = makeKernel();
    Effect.runSync(
      kernel.load(webMcpPlugin({ modelContext: () => page, invoke: host([READ]).invoke })),
    );
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(names(page)).toEqual(["node.get"]);
    Effect.runSync(kernel.unload("webmcp"));
    expect(names(page)).toEqual([]);
  });
});
