/**
 * The WebMCP adapter's lifecycle: when it registers, when it unregisters, and
 * what a tool call returns. What it lists and answers for the real registry
 * is the surface contract's business (`packages/app/cli/tests/surface-contract.test.ts`).
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { ActionInvocation, ActionReceipt, ManifestEntry } from "@kb/contracts";
import { makeKernel } from "@kb/plugin";
import { FakeModelContext } from "@kb/test-kit";
import { modelContextOf, startWebMcp, webMcpPlugin, type WebMcpOptions } from "../src/index.ts";

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

  test("a host that throws is answered with an internal failure", async () => {
    const page = new FakeModelContext();
    const invoke = (invocation: ActionInvocation): Promise<ActionReceipt> =>
      invocation.id === "kb.manifest"
        ? Promise.resolve({ status: "succeeded", id: invocation.id, output: { actions: [READ] } })
        : Promise.reject(new Error("network down"));
    await startWebMcp({ modelContext: () => page, invoke }).settled();
    expect(await page.tool("node.get")?.execute(undefined)).toMatchObject({
      status: "failed",
      id: "node.get",
      code: "internal",
      message: "network down",
    });
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
