/**
 * vp-friendly catalog smoke: every story module renders without throwing.
 * Behavioral coverage stays in colocated `*.test.tsx` next to components.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { stories as tagChip } from "./tag-chip.stories";
import { stories as bullet } from "./bullet.stories";
import { stories as nodeRow } from "./node-row.stories";
import { stories as fieldValue } from "./field-value.stories";
import { stories as canvasCard } from "./canvas-card.stories";
import { stories as graphToolbar } from "./graph-toolbar.stories";

const catalogDir = path.dirname(fileURLToPath(import.meta.url));

type StoryBag = Record<string, () => ReactElement>;

const modules: { name: string; stories: StoryBag }[] = [
  { name: "tag-chip", stories: tagChip },
  { name: "bullet", stories: bullet },
  { name: "node-row", stories: nodeRow },
  { name: "field-value", stories: fieldValue },
  { name: "canvas-card", stories: canvasCard },
  { name: "graph-toolbar", stories: graphToolbar },
];

describe("component catalog smoke", () => {
  for (const mod of modules) {
    describe(mod.name, () => {
      for (const [variant, render] of Object.entries(mod.stories)) {
        it(`renders ${variant}`, () => {
          const html = renderToStaticMarkup(createElement(render));
          expect(html.length).toBeGreaterThan(0);
        });
      }
    });
  }

  it("documents at least 2 variants per core primitive", () => {
    for (const mod of modules) {
      expect(
        Object.keys(mod.stories).length,
        `${mod.name} needs ≥2 stories`,
      ).toBeGreaterThanOrEqual(2);
    }
  });
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
