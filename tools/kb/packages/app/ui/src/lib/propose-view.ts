/**
 * The UI's one way to make a view node from settings: `view.propose`, the
 * one check of a proposed view (DESIGN.md → View nodes), so the UI writes
 * exactly what an agent could propose. The UI mints the node's id and names
 * it in the call (DESIGN-UI.md → Mutations: the client mints final ULIDs), so
 * the local commit and the server's are one node: left to the action, each
 * would mint its own.
 */
import { Predicate } from "effect";
import { ulid } from "ulid";
import type { ProposedView, ViewProposal } from "@kb/ui-sdk";
import { invoke } from "@/session/runtime";

/** The new view node's id, or the receipt's message when the proposal was refused. */
export async function proposeView(proposal: ViewProposal): Promise<ProposedView> {
  const receipt = await invoke("view.propose", {
    id: ulid(),
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
