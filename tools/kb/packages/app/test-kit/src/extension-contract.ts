/**
 * The extension contract: what every family promises (DESIGN.md → Extension
 * families → Enforcement), written once and run over each of them. The
 * server's bundled list runs it from `@kb/runtime`'s tests, and the agent,
 * which its host composes, from `@kb/cli`'s, so a promise one family keeps
 * and another breaks goes red.
 *
 * It holds the promises every family can be asked today:
 * - its entry plugin takes its name from its declaration;
 * - it loads, and unloads leaving nothing behind;
 * - its seed folds beside the bundled one with no id owned twice;
 * - every view key it contributes has an option in that fold.
 *
 * The text-body and page-catalog promises join when the first family
 * contributes a view of its own (step E7 of the extension-boundaries plan).
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
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
import { CONTRACT_AT } from "./store-session.ts";

/** Every contribution the kernel holds at the points a family contributes to. */
function contributions(kernel: Kernel): readonly string[] {
  return [
    ...kernel.contributions(ActionPoint),
    ...kernel.contributions(TemplatePoint),
    ...kernel.contributions(ViewKeyPoint),
    ...kernel.contributions(ChannelPoint),
  ].map((contribution) => contribution.id);
}

/** The bundled declarations, with this one in its place or at the end. */
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

    test("its seed folds beside the bundled one with no id owned twice", () => {
      expect(() => foldSeed(foldWith(declaration), CONTRACT_AT)).not.toThrow();
    });

    test("every view key it contributes has an option in the fold", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const kernel = makeKernel();
          yield* kernel.load(entry);
          const seeded = new Set(
            foldSeed(foldWith(declaration), CONTRACT_AT).map((node) => node.id),
          );
          const orphans = kernel
            .contributions(ViewKeyPoint)
            .map((view) => view.id)
            .filter((id) => !seeded.has(viewOptionId(id)));
          yield* kernel.shutdown;
          expect(orphans).toEqual([]);
        }),
      ));
  });
}
