/**
 * Comment threads over the canvas (DESIGN-UI.md → Canvas → Comments): a
 * pin for each thread where the shown projection draws what it is on
 * (`threadPins`, the camera model's), and the panel a pin opens, where a
 * person reads a thread, replies, and resolves or reopens it. The panel
 * opens as the inspectors do (`CanvasPopover`).
 */
import { useState } from "react";
import { ChatCircleIcon } from "@phosphor-icons/react";
import type { CanvasDoc, CanvasThread } from "@kb/canvas";
import { cn, PopoverShell } from "@kb/ui-sdk";
import type { CanvasView } from "./canvas-camera";
import type { CanvasCameraRig } from "./canvas-camera-rig";
import { CanvasPopover } from "./canvas-popover";
import { threadPins } from "./canvas-visible";
import type { CanvasComments } from "./use-canvas-comments";
import { useShownView } from "./use-shown-view";

/**
 * Each thread's pin, drawn over the stage where the shown camera puts what
 * it is pinned on, and cut off at the stage's edge as the items are.
 */
export function CanvasCommentPins({
  rig,
  in3d,
  flatView,
  width,
  height,
  doc,
  comments,
}: {
  readonly rig: CanvasCameraRig;
  /** The 3D scene is the one showing (otherwise the view is `flatView`). */
  readonly in3d: boolean;
  readonly flatView: CanvasView;
  readonly width: number;
  readonly height: number;
  readonly doc: CanvasDoc;
  readonly comments: CanvasComments;
}) {
  const view = useShownView(rig, in3d, flatView);
  const pins = threadPins(comments.threads, doc, view, { width, height });
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {pins.map(({ thread, item, at }) => (
        <button
          key={`${thread.id}:${item ?? "at"}`}
          type="button"
          data-comment-pin={thread.id}
          aria-label={`Comment: ${thread.text}`}
          title={thread.text}
          className={cn(
            "pointer-events-auto absolute flex h-6 w-6 -translate-y-full items-center justify-center",
            "rounded-full rounded-bl-none border border-foreground/15 bg-popover text-foreground/70",
            "shadow-floating hover:text-foreground",
            thread.resolved && "opacity-40",
          )}
          style={{ left: at.x, top: at.y }}
          onClick={(e) => comments.show(thread.id, { x: e.clientX, y: e.clientY })}
        >
          <ChatCircleIcon size={14} />
        </button>
      ))}
    </div>
  );
}

/** The panel open, if any: a thread's, or a new thread's being written. */
export function CanvasCommentPanel({ comments }: { readonly comments: CanvasComments }) {
  const { open } = comments;
  if (open === null) return null;
  return (
    <ThreadPanel
      key={open.thread?.id ?? "new"}
      anchor={open.anchor}
      thread={open.thread}
      comments={comments}
    />
  );
}

const ACTION = cn(
  "rounded-md px-2 py-1 text-meta text-foreground/60 hover:bg-foreground/5 hover:text-foreground/85",
  "disabled:opacity-40 disabled:hover:bg-transparent",
);

function ThreadPanel({
  anchor,
  thread,
  comments,
}: {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly thread: CanvasThread | null;
  readonly comments: CanvasComments;
}) {
  const [draft, setDraft] = useState("");
  const send = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    void comments.post(text);
  };
  const title = thread === null ? "New comment" : thread.resolved ? "Resolved comment" : "Comment";
  // GAP [[01M54GBYH3K67TAW016HFCJHBC]] a comment shows what it says, not who said it: the store keeps no writer for a node
  const said = thread === null ? [] : [thread, ...thread.replies];
  return (
    <CanvasPopover anchor={anchor} onClose={comments.close}>
      <PopoverShell title={title} className="w-72" data-testid="comment-panel">
        {said.map((comment) => (
          <p
            key={comment.id}
            data-comment={comment.id}
            className="whitespace-pre-wrap px-1.5 py-1 text-ui text-foreground/80"
          >
            {comment.text}
          </p>
        ))}
        <textarea
          autoFocus
          aria-label={thread === null ? "Comment" : "Reply"}
          placeholder={thread === null ? "Comment…" : "Reply…"}
          rows={2}
          value={draft}
          className="mt-1 w-full resize-none rounded-md border border-foreground/10 bg-background px-2 py-1 text-ui outline-none"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            send();
          }}
        />
        <div className="flex items-center justify-between pt-1">
          {thread === null ? (
            <span />
          ) : (
            <button
              type="button"
              className={ACTION}
              onClick={() => void comments.resolve(!thread.resolved)}
            >
              {thread.resolved ? "Reopen" : "Resolve"}
            </button>
          )}
          <button type="button" className={ACTION} disabled={draft.trim() === ""} onClick={send}>
            {thread === null ? "Comment" : "Reply"}
          </button>
        </div>
      </PopoverShell>
    </CanvasPopover>
  );
}
