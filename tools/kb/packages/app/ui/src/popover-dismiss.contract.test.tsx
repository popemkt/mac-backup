/**
 * The shell's popovers, each run through the dismiss contract
 * (`dismissContract`, DESIGN-UI.md → Cross-surface polish → Popovers dismiss
 * one way): Preferences, the add-a-ref picker and the pane switcher; and
 * those the shell hosts for its kits and families, which need its stores
 * to open: the ontology picker and the outline's frame filter.
 */
import { act } from "react";
import { ViewFilterPopoverHost } from "@kb/outline-ui";
import { OntologyPicker } from "@kb/ui-sdk";
import { dismissContract, renderPopover } from "@kb/ui-test-kit";
import { fixtureGraph } from "@/api/fixture-graph";
import { PaneSwitcher } from "@/components/layout/pane-switcher";
import { RefAddPopover } from "@/components/ontology/ref-add-popover";
import { PreferencesPopover, PreferencesTrigger } from "@/components/prefs/preferences-popover";
import { useGraphStore } from "@/stores/graph.store";
import { useUiStore } from "@/stores/ui.store";

const noop = () => {};
const find = (selector: string) => () => document.querySelector(selector);
const trigger = (selector: string) => () => document.querySelector<HTMLElement>(selector);

dismissContract({
  "packages/app/ui/src/components/prefs/preferences-popover.tsx": (host) => {
    const shown = renderPopover(
      host,
      <>
        <PreferencesTrigger />
        <PreferencesPopover switches={[]} onSwitch={noop} />
      </>,
      find('[role="dialog"][aria-label="Preferences"]'),
      trigger('button[data-preferences-trigger="true"]'),
    );
    return {
      ...shown,
      unmount: () => {
        useUiStore.getState().setPrefsOpen(false);
        shown.unmount();
      },
    };
  },
  "packages/app/ui/src/components/ontology/ref-add-popover.tsx": (host) =>
    renderPopover(
      host,
      <RefAddPopover
        trigger="add"
        title="Add a ref"
        candidates={[{ id: "n1", label: "One" }]}
        onPick={noop}
      />,
      find('div[role="dialog"][aria-label="Add a ref"]'),
      trigger('button[aria-haspopup="listbox"]'),
    ),
  "packages/app/ui/src/components/layout/pane-switcher.tsx": (host) =>
    renderPopover(
      host,
      <PaneSwitcher path="/" title="Home" onChoose={noop} />,
      find('[role="menu"][aria-label="Show in this pane"]'),
      trigger('button[aria-haspopup="menu"]'),
    ),
  "packages/kit/ui-sdk/src/components/ontology-picker.tsx": (host) =>
    renderPopover(
      host,
      <OntologyPicker ontologies={[{ id: "o1", label: "Ont" }]} activeId={null} onSelect={noop} />,
      find('[role="listbox"][aria-label="Ontologies"]'),
      trigger('button[aria-label="Ontology"]'),
    ),
  "packages/extension/outline-ui/src/view-filter-popover.tsx": async (host) => {
    useGraphStore.getState().hydrateFromWire(fixtureGraph.nodes, fixtureGraph.rev, "fixtures");
    const frame = fixtureGraph.nodes[0]?.id ?? "";
    // The filter opens beside the frame it filters: here, the frame's row.
    const row = document.createElement("div");
    row.setAttribute("data-node-block", "true");
    row.setAttribute("data-node-id", frame);
    document.body.append(row);
    const shown = renderPopover(
      host,
      <ViewFilterPopoverHost />,
      find('[data-testid="view-filter-popover"]'),
      // Each frame's filter button opens its own frame's filter; the suite opens it by the store.
      null,
    );
    await act(async () => useUiStore.getState().setFilterPopoverFrameId(frame));
    return {
      ...shown,
      unmount: () => {
        useUiStore.getState().setFilterPopoverFrameId(null);
        shown.unmount();
      },
    };
  },
});
