import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { asInstance, sidebarRegionProps } from "@/lib/dom";
import { SidebarSectionPoint, useContributions, useRoute } from "@/lib/plugins";
import { useNarrowViewport } from "@/lib/viewport";
import { useSidebarToggle } from "@/stores/prefs.store";
import { useUiStore } from "@/stores/ui.store";

const SIDEBAR_WIDTH_PX = 220;

/**
 * The sidebar lists what plugins contribute: each section is one plugin's
 * way into its own pages, in `order`.
 *
 * From 768px up it takes its width in the row beside the page. Below that
 * it floats over the page instead, above a scrim that closes it, so an open
 * sidebar never squeezes the page into a sideways scroll.
 */
export function Sidebar() {
  const { open } = useSidebarToggle();
  const narrow = useNarrowViewport();
  const closeOverlay = useUiStore((s) => s.setSidebarOverlayOpen);
  const route = useRoute();
  const contributed = useContributions(SidebarSectionPoint);
  const sections = useMemo(
    () => contributed.toSorted((a, b) => a.value.order - b.value.order),
    [contributed],
  );

  return (
    <>
      {narrow && open ? (
        <button
          type="button"
          aria-label="Close sidebar"
          tabIndex={-1}
          className="fixed inset-0 z-30 bg-scrim/30 md:hidden"
          onClick={() => closeOverlay(false)}
          data-sidebar-scrim="true"
        />
      ) : null}
      <aside
        {...sidebarRegionProps}
        aria-hidden={!open}
        inert={!open}
        className={cn(
          "flex h-full shrink-0 flex-col overflow-hidden border-r border-foreground/[0.06] bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-overlay",
          open ? "w-[220px]" : "w-0 border-r-0",
        )}
        style={{ width: open ? SIDEBAR_WIDTH_PX : 0 }}
        // A row picked from the floating sidebar is a place to go: the
        // overlay has done its job.
        onClick={(e) => {
          if (narrow && (asInstance(e.target, Element)?.closest("button") ?? null) !== null)
            closeOverlay(false);
        }}
      >
        <div className="flex h-full w-[220px] flex-col overflow-y-auto px-2 py-3">
          {sections.map(({ id, value: { Component } }) => (
            <Component key={id} route={route} />
          ))}
        </div>
      </aside>
    </>
  );
}
