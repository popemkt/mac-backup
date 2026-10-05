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
 *   settings, and so does its figure where it draws one;
 * - its host composes it as the store switches it ({@link SwitchingHost}):
 *   as its declaration has it by default where no switch is written; an
 *   optional family switched off is neither held nor reported on, and
 *   switched back on is both again, on the same host, without a restart;
 *   a required family is held and reported on whatever its switch node
 *   says, so nothing that depends on it (a gate such as `docs.check`) can
 *   be switched away.
 *
 * Chart and code are the families with a subject for the seed, view and
 * text promises, canvas for the seed and view promises, and lab, which seeds
 * nothing, for the view promise; canvas and lab have no text of their own.
 * What a figure draws needs the host's painter or engine, so the runtime's
 * tests assert each one's drawn figure by name. The browser
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
  NO_SWITCHES,
  TemplatePoint,
  ViewKeyPoint,
  switchWrites,
  type ExtensionDeclaration,
  type ExtensionRow,
  type NodeLookup,
} from "@kb/contracts";
import { foldSeed, viewOptionId } from "@kb/model";
import { makeKernel, type Contribution, type Kernel, type Plugin } from "@kb/plugin";
import { paramsFromProps } from "@kb/views";
import { CONTRACT_AT, openSession, scratchRoot } from "./store-session.ts";

/** Every contribution the kernel holds at the points a family contributes to. */
function heldBy(kernel: Kernel): readonly Contribution<unknown>[] {
  return [
    ...kernel.contributions(ActionPoint),
    ...kernel.contributions(TemplatePoint),
    ...kernel.contributions(ViewKeyPoint),
    ...kernel.contributions(ChannelPoint),
  ];
}

function contributions(kernel: Kernel): readonly string[] {
  return heldBy(kernel).map((contribution) => contribution.id);
}

/** The ids of what `name`'s plugin, or a child of it, contributed to `kernel`. */
function ownedBy(kernel: Kernel, name: string): readonly string[] {
  return heldBy(kernel)
    .filter(({ owner }) => owner === name || owner.startsWith(`${name}/`))
    .map((contribution) => contribution.id);
}

/**
 * A host that composes the family as a store switches it: the registry for
 * a bundled family, the `kb ui` server for one it hosts. `compose` brings
 * the host to the store `nodeOf` reads, and says what the host reports of
 * the family (its `kb.manifest` row) and the kernel it holds it in. It is
 * called again on the same host, so switching back is held to happen
 * without a restart.
 */
export interface SwitchingHost {
  readonly compose: (
    nodeOf: NodeLookup,
  ) => Effect.Effect<{ readonly row: ExtensionRow | undefined; readonly kernel: Kernel }>;
}

/** A store holding only `declaration`'s switch, written to `on`. */
function switched(declaration: ExtensionDeclaration, on: boolean): NodeLookup {
  const nodes = new Map(
    switchWrites(declaration, on, NO_SWITCHES, CONTRACT_AT).map((node) => [node.id, node]),
  );
  return (id) => nodes.get(id);
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

/** The switch promises: how the family's host composes it as the store switches it. */
function switchPromises(
  declaration: ExtensionDeclaration,
  entry: Plugin,
  host: SwitchingHost,
): void {
  /** What the host holds and reports of the family over `nodeOf`. */
  const composed = (nodeOf: NodeLookup) =>
    host.compose(nodeOf).pipe(
      Effect.map(({ row, kernel }) => ({
        enabled: row?.enabled,
        optional: row?.optional,
        held: ownedBy(kernel, entry.name).length > 0,
      })),
    );

  test("with no switch written, its host composes it as its declaration has it by default", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const on = declaration.optional?.byDefault !== "off";
        expect(yield* composed(NO_SWITCHES)).toEqual({
          enabled: on,
          optional: declaration.optional !== undefined,
          held: on,
        });
      }),
    ));

  // A family is optional or required, so it is held to the one promise that reads its switch.
  if (declaration.optional !== undefined) {
    test("switched off, its host neither holds nor reports it; switched on, both return, on the same host", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          for (const on of [false, true, false, true]) {
            expect({ on, ...(yield* composed(switched(declaration, on))) }).toEqual({
              on,
              enabled: on,
              optional: true,
              held: on,
            });
          }
        }),
      ));
  } else {
    test("it is required: a switch written off is ignored, so nothing that depends on it is switched away", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          expect(yield* composed(switched(declaration, false))).toEqual({
            enabled: true,
            optional: false,
            held: true,
          });
        }),
      ));
  }
}

/**
 * Run every promise over one family: its declaration, the entry a host loads
 * for it, and the host that composes it as the store switches it.
 */
export function extensionContract(
  declaration: ExtensionDeclaration,
  entry: Plugin,
  host: SwitchingHost,
): void {
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

    switchPromises(declaration, entry, host);
  });
}
