/**
 * `proposeView` names the new node's id in its call. `view.propose` runs on
 * the local replica first and is then pushed: an id left to the action is
 * minted twice, once on each side, and the id the UI goes to is one the
 * server never holds.
 */
import { describe, expect, it, vi } from "vitest";
import { LayoutView } from "@kb/views";

const invoke = vi.fn();
vi.mock("@/session/runtime", () => ({ invoke: (id: string, input: unknown) => invoke(id, input) }));

const { proposeView } = await import("./propose-view");

describe("proposeView", () => {
  it("mints the node's id in the call, so every side that runs it writes that node", async () => {
    // As the action does: the id it is given, else one of its own.
    invoke.mockImplementation((_id: string, input: { id?: string }) =>
      Promise.resolve({
        status: "succeeded",
        id: "view.propose",
        output: { id: input.id ?? "minted-by-the-action" },
      }),
    );
    const view = { view: LayoutView, params: { root: { tabs: [] } }, text: "Morning" };
    const first = await proposeView(view);
    const second = await proposeView(view);
    const named = invoke.mock.calls.map(([, input]) => (input as { id?: string }).id);
    expect(named).toEqual([expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/), expect.any(String)]);
    expect([first, second]).toEqual(named.map((id) => ({ id })));
    expect(named[0]).not.toBe(named[1]);
  });
});
