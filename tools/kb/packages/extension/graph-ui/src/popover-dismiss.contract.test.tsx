/**
 * The graph's popovers, each run through the dismiss contract
 * (`dismissContract`, DESIGN-UI.md → Cross-surface polish → Popovers dismiss
 * one way): its settings and its perspective picker.
 */
import { afterAll, beforeAll } from "vitest";
import { decodePerspective } from "@kb/graph";
import { syncUiPlugins } from "@kb/ui-sdk";
import { dismissContract, renderPopover, testBrowserHost, testHostPlugin } from "@kb/ui-test-kit";
import { GraphSettings } from "./graph-settings";
import { PerspectivePicker } from "./perspective-picker";

// The settings read the page's nodes through its host: here, a test host.
beforeAll(() => syncUiPlugins([testHostPlugin(testBrowserHost())]));
afterAll(() => syncUiPlugins([]));

/** A lens with every setting at its default. */
const lens = decodePerspective({ id: "lens", text: "Lens", props: {} }, () => {});
const find = (selector: string) => () => document.querySelector(selector);
const trigger = (selector: string) => () => document.querySelector<HTMLElement>(selector);

dismissContract({
  "packages/extension/graph-ui/src/graph-settings.tsx": (host) =>
    renderPopover(
      host,
      <GraphSettings perspective={lens} />,
      find('[data-testid="graph-settings-panel"]'),
      trigger('[data-testid="graph-settings-toggle"]'),
    ),
  "packages/extension/graph-ui/src/perspective-picker.tsx": (host) =>
    renderPopover(
      host,
      <PerspectivePicker
        perspectives={[lens]}
        activeId="lens"
        renderer={null}
        onSelect={() => {}}
      />,
      find('[role="dialog"][aria-label="Graph perspectives"]'),
      trigger('button[aria-label="Perspective"]'),
    ),
});
