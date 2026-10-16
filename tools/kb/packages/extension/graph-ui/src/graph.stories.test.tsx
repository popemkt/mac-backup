/**
 * The catalog smoke (`storiesRender`, `@kb/ui-test-kit`) over the graph's
 * own stories, which Storybook serves beside `@kb/ui`'s catalog.
 */
import { storiesRender } from "@kb/ui-test-kit";
import * as graphCanvasFrameStories from "./graph-canvas-frame.stories";
import * as graphToolbarStories from "./graph-toolbar.stories";

storiesRender([
  { name: "graph-toolbar", mod: graphToolbarStories },
  { name: "graph-canvas-frame", mod: graphCanvasFrameStories },
]);
