/**
 * The catalog smoke, as one suite a package runs over its own story modules:
 * every CSF story renders without throwing, and every module documents at
 * least two variants. It reads the same `*.stories.tsx` files Storybook
 * serves, via `composeStories` (Storybook's portable-stories API), rather
 * than a second, hand-maintained fixture set, so a variant added to a story
 * module is covered here by itself.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { composeStories } from "@storybook/react";
import { describe, expect, it } from "vitest";

/** One story module, by the name its suite is reported under. */
export interface StoryModule {
  readonly name: string;
  readonly mod: Parameters<typeof composeStories>[0];
}

/** Render every story of every module, and hold each module to two variants. */
export function storiesRender(modules: readonly StoryModule[]): void {
  describe("component catalog smoke", () => {
    for (const { name, mod } of modules) {
      const composed: Record<string, Parameters<typeof createElement>[0]> = composeStories(mod);
      const variantNames = Object.keys(composed);

      describe(name, () => {
        for (const variant of variantNames) {
          it(`renders ${variant}`, () => {
            const Story = composed[variant];
            if (Story === undefined) throw new Error(`${name}: no story ${variant}`);
            expect(() => renderToStaticMarkup(createElement(Story))).not.toThrow();
          });
        }

        it(`documents at least 2 variants`, () => {
          expect(variantNames.length, `${name} needs ≥2 stories`).toBeGreaterThanOrEqual(2);
        });
      });
    }
  });
}
