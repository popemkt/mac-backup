/**
 * The catalog smoke (`storiesRender`, `@kb/ui-test-kit`) over the outline's
 * own stories, which Storybook serves beside `@kb/ui`'s catalog.
 */
import { storiesRender } from "@kb/ui-test-kit";
import * as fieldValueStories from "./field-value.stories";
import * as fieldValueStackStories from "./field-value-stack.stories";

storiesRender([
  { name: "field-value", mod: fieldValueStories },
  { name: "field-value-stack", mod: fieldValueStackStories },
]);
