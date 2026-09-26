import { viewKey, type NoParams } from "@/lib/plugins";

/** The outline plugin's namespace and view keys: what a host imports, never the components. */
export const OUTLINE_NAMESPACE = "outline";

/** The outline, at `/`: a zoom lives in the store, not in the params. */
export const OutlineView = viewKey<NoParams>()(`${OUTLINE_NAMESPACE}.main`);
