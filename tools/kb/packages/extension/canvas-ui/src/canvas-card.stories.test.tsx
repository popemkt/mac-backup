/**
 * The catalog smoke (`storiesRender`, `@kb/ui-test-kit`) over the canvas's
 * own stories, which Storybook serves beside `@kb/ui`'s catalog.
 */
import { storiesRender } from "@kb/ui-test-kit";
import * as canvasCardStories from "./canvas-card.stories";

storiesRender([{ name: "canvas-card", mod: canvasCardStories }]);
