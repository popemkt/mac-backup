/**
 * The code family owns its vocabulary: its declaration seeds `sys.f.code`
 * and `sys.f.code.grant` under the ids core once declared, lists the code
 * view, and its shared plugin, which both hosts load, contributes that view
 * with its text. Where the host binds no engine (the page), the figure draws
 * nothing; the runtime's bound snapshot is `@kb/runtime`'s subject test.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ViewKeyPoint, type KbContext } from "@kb/contracts";
import { makeKernel } from "@kb/plugin";
import { CODE_IDS, CodeView, DEFAULT_GRANT, codeExtension, codePlugin } from "@kb/code";

const AT = "2026-01-01T00:00:00.000Z";

/** The views the shared plugin contributes, as a host's kernel holds them. */
function contributed() {
  return Effect.runSync(
    Effect.gen(function* () {
      const kernel = makeKernel();
      yield* kernel.load(codePlugin());
      const views = kernel.contributions(ViewKeyPoint).map(({ id, value }) => ({ id, value }));
      yield* kernel.shutdown;
      return views;
    }),
  );
}

describe("code family", () => {
  test("its declaration seeds the code fields under their frozen ids", () => {
    expect(codeExtension.seed?.(AT).map((node) => node.id)).toEqual([
      "sys.f.code",
      "sys.f.code.grant",
    ]);
    expect(CODE_IDS).toEqual({ codeField: "sys.f.code", codeGrantField: "sys.f.code.grant" });
  });

  test("its declaration lists the code view", () => {
    expect(codeExtension.views?.map((view) => view.key)).toEqual([CodeView]);
  });

  test("its plugin takes the declaration's name and contributes the view with its text", () => {
    expect(codePlugin().name).toBe(codeExtension.name);
    const views = contributed();
    expect(views.map((view) => view.id)).toEqual([CodeView.id]);
    expect(views.map((view) => view.value.text?.figure !== undefined)).toEqual([true]);
  });

  test("on a host that binds no engine, its figure draws nothing", async () => {
    const [view] = contributed();
    // The figure reads only its references before it gives up, so no session is opened.
    const ctx = {} as KbContext;
    const params = { code: 'kb.draw("drawn");', grant: DEFAULT_GRANT };
    const figure = view?.value.text?.figure?.(ctx, params, null);
    expect(figure === undefined ? "no figure" : await Effect.runPromise(figure)).toBeNull();
  });
});
