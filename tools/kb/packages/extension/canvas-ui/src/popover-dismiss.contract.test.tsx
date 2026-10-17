/**
 * The canvas's popovers, each run through the dismiss contract
 * (`dismissContract`, DESIGN-UI.md → Cross-surface polish → Popovers dismiss
 * one way): its inspectors' popover, the solid picker, the view menu, the
 * shortcuts sheet and the node picker.
 */
import { useState } from "react";
import { afterAll, beforeAll } from "vitest";
import { TIMING_FALLBACK, syncUiPlugins } from "@kb/ui-sdk";
import {
  UntilDismissed,
  dismissContract,
  renderPopover,
  testBrowserHost,
  testHostPlugin,
} from "@kb/ui-test-kit";
import { viewOfPan } from "./canvas-camera";
import { CanvasCameraRig } from "./canvas-camera-rig";
import { CanvasPopover } from "./canvas-popover";
import { CanvasShortcutsSheet } from "./canvas-shortcuts-sheet";
import { CanvasToolbar } from "./canvas-toolbar";
import { CanvasViewWidget } from "./canvas-view-widget";
import { NodePicker } from "./node-picker";

// The node picker lists the page's nodes through its host: here, a test host.
beforeAll(() => syncUiPlugins([testHostPlugin(testBrowserHost())]));
afterAll(() => syncUiPlugins([]));

const noop = () => {};
const find = (selector: string) => () => document.querySelector(selector);
const flat = viewOfPan({ x: 0, y: 0 }, 1, { width: 800, height: 600 });
const trigger = (selector: string) => () => document.querySelector<HTMLElement>(selector);

/** The view widget as the canvas holds it: its menu closed until its button opens it. */
function ViewWidget() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <CanvasViewWidget
      rig={new CanvasCameraRig(flat, TIMING_FALLBACK, true)}
      in3d={false}
      flatView={flat}
      projection="2d"
      selectionEmpty
      frames={[]}
      menuOpen={menuOpen}
      onMenuOpenChange={setMenuOpen}
      onIntent={noop}
    />
  );
}

dismissContract({
  "packages/extension/canvas-ui/src/canvas-popover.tsx": (host) =>
    renderPopover(
      host,
      <UntilDismissed>
        {(dismiss) => (
          <CanvasPopover anchor={{ x: 200, y: 100 }} onClose={dismiss}>
            <p data-testid="inspected">an inspector</p>
          </CanvasPopover>
        )}
      </UntilDismissed>,
      find('[data-testid="inspected"]'),
      null,
    ),
  "packages/extension/canvas-ui/src/canvas-toolbar.tsx": (host) =>
    renderPopover(
      host,
      <CanvasToolbar
        projection="3d"
        onProjectionChange={noop}
        toolState={{ tool: "select" }}
        onToolChange={noop}
        onToolDoubleClick={noop}
      />,
      find('[data-testid="canvas-solid-picker"]'),
      trigger('[data-tool="box"]'),
    ),
  "packages/extension/canvas-ui/src/canvas-view-widget.tsx": (host) =>
    renderPopover(
      host,
      <ViewWidget />,
      find('[data-testid="canvas-view-menu"]'),
      trigger('button[aria-haspopup="menu"]'),
    ),
  "packages/extension/canvas-ui/src/canvas-shortcuts-sheet.tsx": (host) =>
    renderPopover(
      host,
      <UntilDismissed>
        {(dismiss) => <CanvasShortcutsSheet open onClose={dismiss} />}
      </UntilDismissed>,
      find('[data-testid="canvas-shortcuts"]'),
      null,
    ),
  "packages/extension/canvas-ui/src/node-picker.tsx": (host) =>
    renderPopover(
      host,
      <UntilDismissed>
        {(dismiss) => <NodePicker onPick={noop} onClose={dismiss} />}
      </UntilDismissed>,
      find('input[placeholder="Add existing node…"]'),
      null,
    ),
});
