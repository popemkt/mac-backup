/**
 * The comment threads on a canvas as the page shows them (DESIGN-UI.md →
 * Canvas → Comments): which thread's panel is open and where, and what a
 * person writes from it. A comment is written through the verb an agent
 * and a script comment through (`ext.canvas.comment`), and resolving or
 * reopening a thread is writing its option field, as any field is written.
 */
import { useState } from "react";
import { browserHost, logError } from "@kb/ui-sdk";
import { CANVAS_IDS, type CanvasThread, type CanvasWorld, type CommentPlace } from "@kb/canvas";

/** A point in the window, where a panel opens. */
interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

/** The panel asked for: a thread's, or a new thread's at the place the comment tool was pressed. */
type CommentAsk =
  | { readonly anchor: ClientPoint; readonly thread: string }
  | { readonly anchor: ClientPoint; readonly place: CommentPlace };

export interface CanvasComments {
  /** The threads on the canvas, each with its pin, its replies and whether it is resolved. */
  readonly threads: readonly CanvasThread[];
  /** The panel open, with the thread it shows; null for a new thread being written. */
  readonly open: { readonly anchor: ClientPoint; readonly thread: CanvasThread | null } | null;
  /** Open a new thread's panel at `place`, the comment tool's press. */
  readonly start: (place: CommentPlace, anchor: ClientPoint) => void;
  /** Open `thread`'s panel. */
  readonly show: (thread: string, anchor: ClientPoint) => void;
  readonly close: () => void;
  /** Write `text`: the new thread, or a reply to the thread open. */
  readonly post: (text: string) => Promise<void>;
  /** Resolve the thread open, or reopen it. */
  readonly resolve: (resolved: boolean) => Promise<void>;
}

/** The id of the comment a verb's receipt says it wrote, if it says one. */
function writtenId(output: unknown): string | null {
  if (typeof output !== "object" || output === null || !("id" in output)) return null;
  return typeof output.id === "string" ? output.id : null;
}

export function useCanvasComments(canvasId: string, world: CanvasWorld): CanvasComments {
  const [ask, setAsk] = useState<CommentAsk | null>(null);
  const threads = world.threadsOn(canvasId);
  // A thread just written opens once kb holds it.
  const asked =
    ask !== null && "thread" in ask ? threads.find((one) => one.id === ask.thread) : null;
  const open = ask === null || asked === undefined ? null : { anchor: ask.anchor, thread: asked };

  const post = async (text: string) => {
    if (ask === null) return;
    const where = "thread" in ask ? { replyTo: ask.thread } : ask.place;
    const receipt = await browserHost().invoke("ext.canvas.comment", { canvasId, text, ...where });
    if (receipt.status === "failed") {
      logError("[kb/canvas] comment failed:", receipt.message);
      return;
    }
    const id = writtenId(receipt.output);
    if ("place" in ask && id !== null) setAsk({ anchor: ask.anchor, thread: id });
  };

  const resolve = async (resolved: boolean) => {
    if (ask === null || !("thread" in ask)) return;
    const field = CANVAS_IDS.commentStateField;
    const state = resolved ? CANVAS_IDS.commentResolved : CANVAS_IDS.commentOpen;
    const receipt = await browserHost().invoke("node.update", {
      id: ask.thread,
      unsetProps: [{ field }],
      setProps: [{ field, value: { t: "ref", v: state } }],
    });
    if (receipt.status === "failed") logError("[kb/canvas] resolving failed:", receipt.message);
  };

  return {
    threads,
    open,
    start: (place, anchor) => setAsk({ anchor, place }),
    show: (thread, anchor) => setAsk({ anchor, thread }),
    close: () => setAsk(null),
    post,
    resolve,
  };
}
