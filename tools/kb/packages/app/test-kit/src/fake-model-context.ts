/**
 * A `document.modelContext` for tests, kept to the WebMCP draft of 2026-09-29
 * in what it refuses: a tool name outside 1–128 characters of
 * `[A-Za-z0-9_.-]`, a second tool of a name already registered, and a
 * registration whose signal has already aborted (an `AbortError`). A tool
 * leaves when the signal it was registered with aborts, which is the draft's
 * only way to unregister.
 */
import type { ModelContext, ModelContextTool } from "@kb/webmcp";

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export class FakeModelContext implements ModelContext {
  readonly #tools = new Map<string, ModelContextTool>();

  registerTool(tool: ModelContextTool, options?: { readonly signal?: AbortSignal }): Promise<void> {
    if (!TOOL_NAME.test(tool.name)) {
      return Promise.reject(new TypeError(`invalid tool name: ${tool.name}`));
    }
    if (this.#tools.has(tool.name)) {
      return Promise.reject(new Error(`InvalidStateError: ${tool.name} is already registered`));
    }
    const signal = options?.signal;
    if (signal?.aborted === true) {
      return Promise.reject(new DOMException("The registration was aborted.", "AbortError"));
    }
    this.#tools.set(tool.name, tool);
    signal?.addEventListener("abort", () => this.#tools.delete(tool.name), { once: true });
    return Promise.resolve();
  }

  /** The tools registered now, in registration order. */
  tools(): readonly ModelContextTool[] {
    return [...this.#tools.values()];
  }

  /** The tool of this name, as an agent would find it; `undefined` when none is registered. */
  tool(name: string): ModelContextTool | undefined {
    return this.#tools.get(name);
  }
}
