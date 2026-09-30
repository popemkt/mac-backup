import { createContext, useContext } from "react";
import type { SlotChain } from "@/lib/view-key";

/** The slots around this point of the tree (`SlotChain`); only `ViewSlot` writes it. */
export const EnclosingSlots = createContext<SlotChain>([]);

/** The slots around the caller: what a host hands the keyboard walk, so both ask one rule. */
export function useSlotChain(): SlotChain {
  return useContext(EnclosingSlots);
}
