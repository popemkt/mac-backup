import type { ReactNode } from "react";
import {
  cn,
  matchRoute,
  NotFound,
  RoutePoint,
  useContributions,
  ViewSlot,
  WorkspaceState,
  type ResolvedRoute,
} from "@kb/ui-sdk";

const NOT_FOUND = <NotFound what="Page" back={{ label: "Home", path: "/" }} />;

/**
 * A pane's scroll region.
 *
 * It owns the scrollbar gutter, and reserves it whether or not this view
 * happens to overflow (`::-webkit-scrollbar` is 6px wide and therefore takes
 * layout width, see index.css). Without that, a long view had a scrollbar and
 * a short one did not, the content box changed width by 6px between them, and
 * the centered column — breadcrumb included — shifted ~3px. Fixing it here is
 * what keeps every downstream element free of compensating offsets.
 */
export function ScrollRegion({
  scroll,
  children,
}: {
  /** Canvas owns its own viewport and deliberately does not scroll. */
  readonly scroll: boolean;
  readonly children: ReactNode;
}) {
  return (
    <main
      className={cn(
        "min-h-0 flex-1",
        // `overflow-y: scroll`, not `auto` + `scrollbar-gutter: stable`. Both
        // reserve the 6px track so an overflowing view and a short one resolve
        // to the same content width (that width difference is what moved the
        // centered column, and the breadcrumb with it). Only this one works
        // everywhere: scrollbar-gutter needs Safari 18.2+.
        scroll ? "overflow-x-auto overflow-y-scroll" : "overflow-hidden",
      )}
      data-main-region={scroll ? "scroll" : "fixed"}
    >
      {children}
    </main>
  );
}

/**
 * The matched route's view, in the page slot. A plugin's page owns its own
 * boundary; the slot's only keeps a page that lacks one from taking the pane
 * down with it. A route whose view is not loaded is not found.
 */
function RouteBody({ route, subject }: { route: ResolvedRoute; subject: string | undefined }) {
  return (
    <ViewSlot
      view={route.view}
      params={route.params}
      placement="page"
      fallback={NOT_FOUND}
      pending={<WorkspaceState title={route.pendingTitle} loading />}
      {...(subject === undefined ? {} : { subject })}
    />
  );
}

/**
 * What a pane shows at `path`: the page the route table resolves it to, with
 * the route's chrome above it and, unless the page owns its own viewport, a
 * scroll region around it. A path no route owns is not found.
 *
 * `subject` is what the pane's slot shows its page for where panes nest (a
 * dashboard's panes give their locations), so a layout open inside itself is
 * a repeat the slot refuses rather than a page drawn forever.
 */
export function PaneFrame({ path, subject }: { readonly path: string; readonly subject?: string }) {
  const route = matchRoute(useContributions(RoutePoint), path);
  const body = route === null ? NOT_FOUND : <RouteBody route={route} subject={subject} />;
  return (
    <>
      {route?.chrome}
      {route?.frame === "full" ? (
        body
      ) : (
        <ScrollRegion scroll={route === null || route.frame === "scroll"}>{body}</ScrollRegion>
      )}
    </>
  );
}
