/**
 * The extension contract: what every family promises (DESIGN.md → Extension
 * families → Enforcement), written once and run over each of them. The
 * server's resolved bundled list runs it from `@kb/runtime`'s tests, and the
 * agent, which its host composes, from `@kb/cli`'s, so a promise one family
 * keeps and another breaks goes red.
 *
 * What it proves:
 * - the entry plugin takes its name from the declaration;
 * - the family loads, and unloads leaving nothing behind;
 * - the views the entry contributes are exactly the views the declaration
 *   lists, so no family reaches the catalog past its declaration;
 * - its seed folds beside the bundled one with no id owned twice, and every
 *   view it declares has an option in that fold;
 * - every text body its entry contributes renders its key's default
 *   settings, and so does its figure where it draws one.
 *
 * Chart and code are the families with a subject for the seed, view and
 * text promises, and lab, which seeds nothing and has no text of its own,
 * for the view promise. What a figure draws needs the host's painter or
 * engine, so the runtime's tests assert each one's drawn figure by name.
 * Until canvas moves, core still seeds the canvas's fields
 * (GAP [[01M39F3MR3HT2NR553FY8CRD6X]]) and catalogues its views through its
 * declaration (GAP [[01M3YM5XYZ4VHEK39RNQ6WWRPK]]). The browser
 * half — every view a family gives the UI has a key in the page's catalog —
 * is the UI's view contract (`view-contract.test.tsx` in `@kb/ui`), which
 * runs over the page kernel.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import {
  ActionPoint,
  ChannelPoint,
  TemplatePoint,
  ViewKeyPoint,
  type ExtensionDeclaration,
} from "@kb/contracts";
import { foldSeed, viewOptionId } from "@kb/model";
import { makeKernel, type Kernel, type Plugin } from "@kb/plugin";
import { paramsFromProps } from "@kb/views";
import { CONTRACT_AT, openSession, scratchRoot } from "./store-session.ts";

/** Every contribution the kernel holds at the points a family contributes to. */
function contributions(kernel: Kernel): readonly string[] {
  return [
    ...kernel.contributions(ActionPoint),
    ...kernel.contributions(TemplatePoint),
    ...kernel.contributions(ViewKeyPoint),
    ...kernel.contributions(ChannelPoint),
  ].map((contribution) => contribution.id);
}

/**
 * The seed fold this family is opened under: the bundled declarations, which
 * already hold a bundled family, plus this one when it is a host plugin.
 */
function foldWith(declaration: ExtensionDeclaration): readonly ExtensionDeclaration[] {
  return BUNDLED_DECLARATIONS.includes(declaration)
    ? BUNDLED_DECLARATIONS
    : [...BUNDLED_DECLARATIONS, declaration];
}

/** Run every promise over one family: its declaration and the entry a host loads for it. */
export function extensionContract(declaration: ExtensionDeclaration, entry: Plugin): void {
  describe(`extension contract: ${declaration.name}`, () => {
    test("its entry plugin takes its name from its declaration", () => {
      expect(entry.name).toBe(declaration.name);
    });

    test("it loads, and unloads leaving nothing behind", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const kernel = makeKernel();
          yield* kernel.load(entry);
          expect(kernel.plugins().map((plugin) => plugin.name)).toContain(entry.name);
          expect(kernel.plugins().filter((plugin) => plugin.status === "failed")).toEqual([]);
          yield* kernel.unload(entry.name);
          expect(kernel.plugins()).toEqual([]);
          expect(contributions(kernel)).toEqual([]);
        }),
      ));

    test("the views it contributes are exactly the views it declares", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const kernel = makeKernel();
          yield* kernel.load(entry);
          const contributed = kernel.contributions(ViewKeyPoint).map((view) => view.id);
          yield* kernel.shutdown;
          expect(contributed.toSorted()).toEqual(
            (declaration.views ?? []).map((view) => view.key.id).toSorted(),
          );
        }),
      ));

    test("its seed folds beside the bundled one with no id owned twice", () => {
      expect(() => foldSeed(foldWith(declaration), CONTRACT_AT)).not.toThrow();
    });

    test("every view it declares has an option in the fold", () => {
      const seeded = new Set(foldSeed(foldWith(declaration), CONTRACT_AT).map((node) => node.id));
      const orphans = (declaration.views ?? [])
        .map((view) => view.key.id)
        .filter((id) => !seeded.has(viewOptionId(id)));
      expect(orphans).toEqual([]);
    });

    test("every text body it contributes renders its key's default settings", () =>
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const ctx = yield* openSession(yield* scratchRoot);
            const kernel = makeKernel();
            yield* kernel.load(entry);
            const views = kernel.contributions(ViewKeyPoint).map(({ value }) => value);
            yield* kernel.shutdown;
            for (const { key, text } of views) {
              if (text === undefined) continue;
              const params = paramsFromProps(key, {}, null, () => {});
              expect(Result.isFailure(params) ? `${key.id}: ${params.failure}` : null).toBeNull();
              if (Result.isFailure(params)) continue;
              const body = text.body(ctx, params.success, null);
              expect(body.every((line) => typeof line === "string")).toBe(true);
              if (text.figure === undefined) continue;
              const figure = yield* text.figure(ctx, params.success, null);
              expect(figure === null || typeof figure === "string").toBe(true);
            }
          }),
        ),
      ));
  });
}
