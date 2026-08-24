/**
 * vp-friendly catalog smoke: every CSF story renders without throwing.
 *
 * This reads the same `*.stories.tsx` files Storybook serves — via
 * `composeStories` (Storybook's portable-stories API) rather than a second,
 * hand-maintained fixture set. Adding a variant to an existing story module
 * covers it here automatically; a new story *file* still needs one import
 * line below (static imports, not `import.meta.glob`: this suite also runs
 * under plain `bun test`, which does not implement Vite's glob import).
 *
 * Behavioral coverage stays in colocated `*.test.tsx` next to components.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { composeStories } from "@storybook/react";
import { describe, expect, it } from "vitest";
import * as bulletStories from "./bullet.stories";
import * as tagChipStories from "./tag-chip.stories";
import * as tagChipGroupStories from "./tag-chip-group.stories";
import * as nodeRowStories from "./node-row.stories";
import * as fieldValueStories from "./field-value.stories";
import * as fieldValueStackStories from "./field-value-stack.stories";
import * as canvasCardStories from "./canvas-card.stories";
import * as graphToolbarStories from "./graph-toolbar.stories";
import * as nodeContentStories from "./node-content.stories";
import * as graphCanvasFrameStories from "./graph-canvas-frame.stories";
import * as refAutocompleteStories from "./ref-autocomplete.stories";

const catalogDir = path.dirname(fileURLToPath(import.meta.url));

const modules: { name: string; mod: Parameters<typeof composeStories>[0] }[] = [
  { name: "bullet", mod: bulletStories },
  { name: "tag-chip", mod: tagChipStories },
  { name: "tag-chip-group", mod: tagChipGroupStories },
  { name: "node-row", mod: nodeRowStories },
  { name: "field-value", mod: fieldValueStories },
  { name: "field-value-stack", mod: fieldValueStackStories },
  { name: "canvas-card", mod: canvasCardStories },
  { name: "graph-toolbar", mod: graphToolbarStories },
  { name: "node-content", mod: nodeContentStories },
  { name: "graph-canvas-frame", mod: graphCanvasFrameStories },
  { name: "ref-autocomplete", mod: refAutocompleteStories },
];

describe("component catalog smoke", () => {
  for (const { name, mod } of modules) {
    const composed = composeStories(mod);
    const variantNames = Object.keys(composed);

    describe(name, () => {
      for (const variant of variantNames) {
        it(`renders ${variant}`, () => {
          const Story = composed[variant as keyof typeof composed];
          expect(() =>
            renderToStaticMarkup(createElement(Story)),
          ).not.toThrow();
        });
      }

      it(`documents at least 2 variants`, () => {
        expect(
          variantNames.length,
          `${name} needs \u22652 stories`,
        ).toBeGreaterThanOrEqual(2);
      });
    });
  }
});

describe("surface error-boundary wiring (App)", () => {
  it("wraps outline and sidebar so one crash cannot blank the shell", () => {
    const appSrc = readFileSync(
      path.join(catalogDir, "../components/App.tsx"),
      "utf8",
    );
    expect(appSrc).toContain('title="Outline crashed"');
    expect(appSrc).toContain('title="Sidebar crashed"');
    expect(appSrc).toContain('title="Graph crashed"');
    expect(appSrc).toContain('title="Canvas crashed"');
  });
});
