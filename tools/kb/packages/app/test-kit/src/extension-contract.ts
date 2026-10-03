/**
 * The extension contract: what every family promises (DESIGN.md → Extension
 * families → Enforcement), written once and run over each of them. The
 * server's resolved bundled list runs it from `@kb/runtime`'s tests, and the
 * agent, which its host composes, from `@kb/cli`'s, so a promise one family
 * keeps and another breaks goes red.
 *
 * What it can prove today:
 * - the entry plugin takes its name from the declaration;
 * - the family loads, and unloads leaving nothing behind;
 * - the views the entry contributes are exactly the views the declaration
 *   lists, so no family reaches the catalog past its declaration.
 *
 * What it cannot prove yet: no family declares seed nodes or views of its
 * own, because chart, code, lab and the canvas vocabulary are still seeded
 * and catalogued through core's declaration. So "no seed id owned twice"
 * and "every view has an option in the fold" run over empty sets for every
 * family, and pass on nothing. They gain a subject as each family's
 * vocabulary moves out of core (E7–E9): GAP [[01M41H2Z7B5GCJXHCRYBS7M3YH]]
 * (seed) and GAP [[01M3YM5XYZ4VHEK39RNQ6WWRPK]] (views). The text-body and
 * page-catalog promises join with the first family view (E7).
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

    // Over empty sets for every family today: see the header.
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
  });
}
