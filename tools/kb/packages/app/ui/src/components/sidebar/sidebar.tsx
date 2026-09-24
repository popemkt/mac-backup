import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { sidebarRegionProps } from "@/lib/dom";
import { SidebarSectionPoint, useContributions, useRoute } from "@/lib/plugins";
import { usePrefsStore } from "@/stores/prefs.store";

const SIDEBAR_WIDTH_PX = 220;

/**
 * The sidebar lists what plugins contribute: each section is one plugin's
 * way into its own pages, in `order`.
 */
export function Sidebar() {
  const open = usePrefsStore((s) => s.sidebarOpen);
  const route = useRoute();
  const contributed = useContributions(SidebarSectionPoint);
  const sections = useMemo(
    () => contributed.toSorted((a, b) => a.value.order - b.value.order),
    [contributed],
  );

  return (
    <aside
      {...sidebarRegionProps}
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-foreground/[0.06] bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
        open ? "w-[220px]" : "w-0 border-r-0",
      )}
      style={{ width: open ? SIDEBAR_WIDTH_PX : 0 }}
    >
      <div className="flex h-full w-[220px] flex-col overflow-y-auto px-2 py-3">
        {sections.map(({ id, value: { Component } }) => (
          <Component key={id} route={route} />
        ))}
      </div>
    </aside>
  );
}
