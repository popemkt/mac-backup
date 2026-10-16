/** What a frame view shows outside a frame's host (`FrameSubject`): there is no frame. */
export function NoFrame() {
  return (
    <p className="px-1 py-0.5 text-meta text-foreground/50" data-no-frame="true">
      No frame to show.
    </p>
  );
}
