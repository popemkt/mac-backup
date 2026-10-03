/**
 * The UI's one way to make a view node from settings: `view.propose`, the
 * one check of a proposed view (DESIGN.md → View nodes), so the UI writes
 * exactly what an agent could propose.
 */
import { Predicate } from "effect";
import type { ViewKey } from "@kb/views";
import { invoke } from "@/session/runtime";

export interface ViewProposal {
  readonly view: ViewKey<unknown>;
  readonly params: Readonly<Record<string, unknown>>;
  /** The node it is shown for, which names it among its views. */
  readonly host?: string;
  readonly text?: string;
}

/** The new view node's id, or the receipt's message when the proposal was refused. */
export async function proposeView(
  proposal: ViewProposal,
): Promise<{ readonly id: string } | { readonly refused: string }> {
  const receipt = await invoke("view.propose", {
    view: proposal.view.id,
    params: proposal.params,
    ...(proposal.host === undefined ? {} : { host: proposal.host }),
    ...(proposal.text === undefined ? {} : { text: proposal.text }),
  });
  if (receipt.status === "failed") return { refused: receipt.message };
  const { output } = receipt;
  return Predicate.isObject(output) && typeof output.id === "string"
    ? { id: output.id }
    : { refused: "view.propose answered without an id" };
}
