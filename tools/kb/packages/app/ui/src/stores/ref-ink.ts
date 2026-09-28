import type { RefInk } from "@/lib/md-edit";
import { schemaOf } from "@/lib/schema";
import { refInkOf } from "@/lib/tag-color";
import { useOutlineStore } from "@/stores/outline.store";

/**
 * How references in rendered text are inked (`RefInk`), from the graph the
 * store holds: `refInkOf` over the whole-graph schema. It lives beside the
 * store for the reason `useFollow` does — the surfaces that render text are
 * primitives, handed it as a prop, and every surface wants the same one.
 */
export function useRefInk(): RefInk {
  return refInkOf(useOutlineStore(schemaOf));
}
