/**
 * What the page does with the locations family's actions: list the rows,
 * open one, forget one. Each is one call through the page's invoke path
 * (`BrowserHost.invoke`), by the alias every surface calls it by, so the
 * page holds nothing of the home store itself.
 *
 * Opening leaves the page: the `kb ui` serving the other root is another
 * process at another URL (DESIGN.md → Locations). The same tab goes there;
 * a new tab is opened before the call, while the click still counts as the
 * person's gesture, and is closed again when the open is refused.
 */
import type { ActionReceipt } from "@kb/contracts";
import { LocationListSchema, LocationOpenedSchema, type LocationList } from "@kb/locations";
import { toast, type BrowserHost } from "@kb/ui-sdk";

/** What the section shows: the rows, or why there are none to show. */
export type Listing =
  | { readonly kind: "loading" }
  | { readonly kind: "listed"; readonly list: LocationList }
  | { readonly kind: "failed"; readonly message: string };

/** A tab opened for a location before its URL is known. */
interface PendingTab {
  go: (url: string) => void;
  close: () => void;
}

/** Where an open leaves the page for: this tab, or a new one. */
export interface PageExits {
  readonly assign: (url: string) => void;
  readonly openTab: () => PendingTab | null;
}

/** The browser's own exits. */
const WINDOW_EXITS: PageExits = {
  assign: (url) => window.location.assign(url),
  openTab: () => {
    const tab = window.open("", "_blank");
    if (tab === null) return null;
    tab.opener = null;
    return { go: (url) => tab.location.assign(url), close: () => tab.close() };
  },
};

type Invoke = BrowserHost["invoke"];

/**
 * One call. A call that cannot be made at all (no server answers the page)
 * reads as a refusal, so the section says so instead of rejecting.
 */
async function call(invoke: Invoke, id: string, input: unknown): Promise<ActionReceipt> {
  try {
    return await invoke(id, input);
  } catch (err) {
    return {
      status: "failed",
      id,
      code: "internal",
      message: `${id} could not be called: ${String(err)}`,
    };
  }
}

/** The home store's rows, or the refusal's message. */
export async function listLocations(invoke: Invoke): Promise<Listing> {
  const receipt = await call(invoke, "location.list", {});
  if (receipt.status === "failed") return { kind: "failed", message: receipt.message };
  const parsed = LocationListSchema.safeParse(receipt.output);
  return parsed.success
    ? { kind: "listed", list: parsed.data }
    : { kind: "failed", message: `the locations could not be read: ${parsed.error.message}` };
}

/**
 * Open the location `id`, or with none the home store, and go to the `kb ui`
 * serving it: in this tab, or in a new one. A refusal is shown and the page
 * stays where it is.
 */
export async function openLocation(
  invoke: Invoke,
  target: { readonly id?: string },
  newTab: boolean,
  exits: PageExits = WINDOW_EXITS,
): Promise<void> {
  const tab = newTab ? exits.openTab() : null;
  const receipt = await call(invoke, "location.open", target);
  const opened =
    receipt.status === "failed"
      ? { url: null, message: receipt.message }
      : { url: LocationOpenedSchema.safeParse(receipt.output).data?.url ?? null, message: "" };
  if (opened.url === null) {
    tab?.close();
    toast(opened.message === "" ? "the location's server gave no URL" : opened.message);
    return;
  }
  if (tab === null) exits.assign(opened.url);
  else tab.go(opened.url);
}

/** Forget the location `id`: its node leaves the home store, and its directory is untouched. */
export async function forgetLocation(invoke: Invoke, id: string): Promise<void> {
  const receipt = await call(invoke, "location.forget", { id });
  if (receipt.status === "failed") toast(receipt.message);
}
