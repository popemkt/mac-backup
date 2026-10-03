/**
 * The page's view catalog (DESIGN.md → Extension families → the view catalog
 * is a point): the views the page kernel's plugins contributed to
 * `ViewKeyPoint`, restricted to the ids the server's `kb.manifest` lists. The
 * page holds the key objects, because decoding params needs code; the server
 * says which of them are loaded. So there is one catalog, read on the server
 * and bridged here, and a page action such as `view.propose` checks against
 * the server's list.
 *
 * Until a server answers — an offline page on its fixtures, or before the
 * manifest arrives — the page is its own server, and its kernel's views are
 * the catalog its own actions run against.
 */
import { useSyncExternalStore } from "react";
import { ViewKeyPoint, type ViewDef } from "@kb/contracts";
import { kbManifestDef } from "@kb/operations";
import type { Contribution } from "@kb/plugin";
import { viewCatalogOf, type ViewCatalogOf } from "@kb/views";
import { postAction } from "@/api/action";
import { logWarn } from "@/lib/log";
import { pointReader, subscribeUiKernel } from "@/lib/plugins";

type PageCatalog = ViewCatalogOf<ViewDef<unknown>>;

/**
 * The page's catalog from what its kernel holds and what the server lists
 * (`served`, null while no server has answered). A key the page holds that
 * the server does not list is reported through `report`, never listed.
 */
export function pageCatalogOf(
  held: readonly ViewDef<unknown>[],
  served: ReadonlySet<string> | null,
  report: (viewId: string) => void,
): PageCatalog {
  if (served === null) return viewCatalogOf(held);
  const listed = held.filter((view) => served.has(view.key.id));
  for (const view of held) if (!served.has(view.key.id)) report(view.key.id);
  return viewCatalogOf(listed);
}

let served: ReadonlySet<string> | null = null;
const servedListeners = new Set<() => void>();
const reported = new Set<string>();

/** Record the view ids the server lists (null: no server answers), and tell the readers. */
function setServedViews(ids: readonly string[] | null): void {
  served = ids === null ? null : new Set(ids);
  for (const listener of servedListeners) listener();
}

/**
 * Ask the server which views it loaded: `kb.manifest`'s view catalog. A
 * server that cannot answer leaves the page its own catalog, and says so in
 * the log; it never fails the boot.
 */
export async function loadServedViews(): Promise<void> {
  const response = await postAction({ id: kbManifestDef.id, input: {} }).catch((error: unknown) => {
    logWarn(`[kb/views] kb.manifest unreachable: ${String(error)}`);
    return null;
  });
  if (response === null) return;
  if (response.status !== "succeeded") {
    logWarn(`[kb/views] kb.manifest failed: ${response.message}`);
    return;
  }
  const manifest = kbManifestDef.outputSchema.safeParse(response.output);
  if (!manifest.success) {
    logWarn(`[kb/views] kb.manifest answered with no view catalog: ${manifest.error.message}`);
    return;
  }
  setServedViews(manifest.data.views.map((view) => view.id));
}

function reportUnlisted(viewId: string): void {
  if (reported.has(viewId)) return;
  reported.add(viewId);
  logWarn(`[kb/views] this page holds ${viewId}, which the server does not list; it is left out`);
}

const readHeld = pointReader(ViewKeyPoint);
let memo: {
  held: readonly Contribution<ViewDef<unknown>>[];
  served: ReadonlySet<string> | null;
  catalog: PageCatalog;
} | null = null;

/** The page's catalog now: the same object until the kernel or the server's list moves. */
export function pageCatalog(): PageCatalog {
  const held = readHeld();
  if (memo?.held !== held || memo.served !== served) {
    memo = {
      held,
      served,
      catalog: pageCatalogOf(
        held.map(({ value }) => value),
        served,
        reportUnlisted,
      ),
    };
  }
  return memo.catalog;
}

function subscribe(listener: () => void): () => void {
  servedListeners.add(listener);
  const unsubscribeKernel = subscribeUiKernel(listener);
  return () => {
    servedListeners.delete(listener);
    unsubscribeKernel();
  };
}

/** The page's catalog, re-read whenever the kernel or the server's list moves. */
export function usePageCatalog(): PageCatalog {
  return useSyncExternalStore(subscribe, pageCatalog, pageCatalog);
}

/**
 * The page's catalog as a service value: every read goes to {@link pageCatalog}
 * at the time of the read, so a session built once sees plugins load and the
 * manifest arrive.
 */
export const livePageCatalog: PageCatalog = {
  get items() {
    return pageCatalog().items;
  },
  itemOf: (view) => pageCatalog().itemOf(view),
  keyOf: (view) => pageCatalog().keyOf(view),
  entries: () => pageCatalog().entries(),
};
