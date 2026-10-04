/**
 * vp-friendly catalog smoke: every CSF story renders without throwing
 * (`storiesRender`, `@kb/ui-test-kit`), over the catalog's own story
 * modules. A new story *file* needs one import line below (static imports,
 * not `import.meta.glob`: this suite also runs under plain `bun test`, which
 * does not implement Vite's glob import).
 *
 * Behavioral coverage stays in colocated `*.test.tsx` next to components.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import * as pickerListStories from "./picker-list.stories";
import { browserSource } from "@/test-support/browser-packages";
import { storiesRender } from "@kb/ui-test-kit";

const catalogDir = path.dirname(fileURLToPath(import.meta.url));

storiesRender([
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
  { name: "picker-list", mod: pickerListStories },
]);

describe("surface error-boundary wiring (App)", () => {
  it("wraps the sidebar and every page so one crash cannot blank the shell", () => {
    const read = (file: string) => readFileSync(path.join(catalogDir, "..", file), "utf8");
    const appSrc = read("components/App.tsx");
    expect(appSrc).toContain('title="Sidebar crashed"');
    // A page that brings no boundary of its own still cannot take the shell
    // down: every pane renders its page through a view slot, which owns one.
    expect(appSrc).toContain("<Workspace");
    expect(read("components/layout/workspace.tsx")).toContain("<PaneFrame");
    expect(read("components/layout/pane-frame.tsx")).toContain("<ViewSlot");
    expect(
      readFileSync(path.join(browserSource("@kb/ui-sdk"), "components/view-slot.tsx"), "utf8"),
    ).toContain('title="View crashed"');
    // Each built-in page owns its boundary, beside the surface that renders it.
    expect(read("components/outline/surfaces.tsx")).toContain('title="Outline crashed"');
    expect(read("components/graph/surfaces.tsx")).toContain('title="Graph crashed"');
    expect(read("components/canvas/surfaces.tsx")).toContain('title="Canvas crashed"');
    expect(read("components/ontology/surfaces.tsx")).toContain('title="Ontology crashed"');
  });
});
