import { NoParams, viewKey } from "@/lib/plugins";
import { OUTLINE_NAMESPACE } from "@/lib/view-config";

/**
 * The outline plugin's page key: what a host imports, never the components.
 * Its frame views' keys live in `lib/view-config.ts`, beside the settings
 * they read, because the navigation walk resolves them without a component.
 */

/** The outline, at `/`: a zoom lives in the store, not in the params. */
export const OutlineView = viewKey(`${OUTLINE_NAMESPACE}.main`, NoParams);
