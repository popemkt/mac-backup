import type { Preview } from "@storybook/react-vite";
import "../src/index.css";

/** Same global stylesheet the app loads (`src/main.tsx`) — tokens, Tailwind,
 * fonts — so a story matches what the outline actually renders. */
const preview: Preview = {
  parameters: {
    layout: "padded",
    a11y: {
      test: "todo",
    },
  },
};

export default preview;
