import { Effect } from "effect";
import { z } from "zod";
import { ScreenListSchema, type TabScreen, type UiHostService } from "@kb/contracts";
import type { AgentMessage } from "./runtime.ts";

/**
 * The prompting: what the agent is told it is, and how each message carries
 * the sender's screen. It belongs to the agent package, so every runtime
 * sends the same words.
 */
export const AGENT_SYSTEM_PROMPT = `You are the agent in the sidebar of kb, a person's knowledge base.

kb is a graph. Everything in it is a node: a note, a task, a tag, a field and a field's allowed values. Relationships between nodes are the model; outlines, tables, boards, canvases and graphs are views of that one graph.

You act on kb only through your tools, which are kb's own actions. Read before you write. Some writes need the person's approval: they see the call, and approve or decline it. A declined call comes back as an approval_required failure; do not try it again unless they ask.

Every message starts with a <screen> block: what the person's kb tab showed when they sent it. It names the route, each pane's open view (its view key and the node it is shown for), the focused node, the selection, and under "names" the text of those nodes. Words like "this", "here" and "the selected one" refer to it. To show the person something, open it with ui.navigate or select it with ui.select.

Be brief. Refer to a node as [[id|label]] so the person can follow it.`;

/** At most this many of the screen's node ids are named, so a large selection stays a short prompt. */
const NAMED_AT_MOST = 12;

const NodeTextSchema = z.object({ node: z.object({ text: z.string() }) });

/** The node ids a screen mentions, the open view's subject and the focus first. */
function mentioned(screen: TabScreen): string[] {
  const ids = screen.panes.flatMap((pane) => [
    ...(pane.view?.subject === undefined ? [] : [pane.view.subject]),
    ...(pane.focused === null ? [] : [pane.focused]),
    ...pane.selection,
  ]);
  return [...new Set(ids)].slice(0, NAMED_AT_MOST);
}

/**
 * The text of each id that names a node. A selection can hold ids that are
 * not nodes (a canvas's items), and those are left out.
 */
const namesOf = Effect.fn("kb.agent.screenNames")(function* (
  host: UiHostService,
  ids: readonly string[],
) {
  const names: Record<string, string> = {};
  for (const id of ids) {
    const receipt = yield* host.invoke({ id: "node.get", input: { id, depth: 0 } });
    if (receipt.status !== "succeeded") continue;
    const read = NodeTextSchema.safeParse(receipt.output);
    if (read.success) names[id] = read.data.node.text;
  }
  return names;
});

/**
 * The screen of the tab `tab`, rendered for the model: `ui.screen` narrowed
 * to that tab, with the text of the nodes it mentions. Null when the sender
 * is no tab, or its tab has gone.
 */
export const screenContext = Effect.fn("kb.agent.screenContext")(function* (
  host: UiHostService,
  tab: string | null,
) {
  if (tab === null) return null;
  const receipt = yield* host.invoke({ id: "ui.screen", input: { tab } });
  if (receipt.status !== "succeeded") return null;
  const screen = ScreenListSchema.safeParse(receipt.output).data?.tabs[0];
  if (screen === undefined) return null;
  const names = yield* namesOf(host, mentioned(screen));
  return JSON.stringify({ ...screen, names }, null, 2);
});

/** The one user message a runtime sends for `message`: the screen block, then what the person wrote. */
export function userTurnText(message: AgentMessage): string {
  const screen = message.screen ?? "No kb tab sent this message, so there is no screen.";
  return `<screen>\n${screen}\n</screen>\n\n${message.text}`;
}
