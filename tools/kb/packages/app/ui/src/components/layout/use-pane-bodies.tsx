/**
 * Pane bodies that outlive their place on screen. Each pane's body is drawn
 * once, into an element of its own, and the layout only places that element
 * (`PaneMount`): in the one-pane workspace, in a dockview group, in another
 * group after a drag. So opening a second pane, moving a tab or resizing
 * never remounts a pane's view — its outline keeps its caret's row, its graph
 * its camera.
 */
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { LayoutPane } from "@kb/views";
import { PaneContext } from "@/lib/pane";

/** Where each pane's body is drawn, by pane id. */
export type ElementOf = (id: string) => HTMLElement;

/**
 * Draw each of `panes` with `render`, inside its pane (`PaneContext`), into
 * an element of its own. `onFocus` hears a pointer or the keyboard enter a
 * pane. Returns where each body is drawn and the portals that draw them,
 * which the caller renders once, wherever its panes are placed.
 */
export function usePaneBodies(
  panes: readonly LayoutPane[],
  render: (pane: LayoutPane) => ReactNode,
  onFocus: (id: string) => void,
): { readonly elementOf: ElementOf; readonly bodies: ReactNode } {
  const [elements] = useState(() => new Map<string, HTMLElement>());
  const elementOf = useCallback<ElementOf>(
    (id) => {
      const known = elements.get(id);
      if (known !== undefined) return known;
      const element = document.createElement("div");
      element.className = "kb-pane flex h-full min-h-0 min-w-0 flex-1 flex-col";
      element.dataset.pane = id;
      elements.set(id, element);
      return element;
    },
    [elements],
  );
  // Entering a pane focuses it; a closed pane's element goes with it.
  useEffect(() => {
    const open = new Set(panes.map((pane) => pane.id));
    for (const id of elements.keys()) if (!open.has(id)) elements.delete(id);
    const listening = panes.map((pane) => {
      const element = elementOf(pane.id);
      const enter = (): void => onFocus(pane.id);
      element.addEventListener("pointerdown", enter, true);
      element.addEventListener("focusin", enter);
      return () => {
        element.removeEventListener("pointerdown", enter, true);
        element.removeEventListener("focusin", enter);
      };
    });
    return () => {
      for (const stop of listening) stop();
    };
  }, [elements, elementOf, panes, onFocus]);
  const bodies = panes.map((pane) =>
    createPortal(
      <PaneContext.Provider value={pane.id}>{render(pane)}</PaneContext.Provider>,
      elementOf(pane.id),
      pane.id,
    ),
  );
  return { elementOf, bodies };
}
