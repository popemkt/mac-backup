/**
 * When a backdrop's animation runs (DESIGN-UI.md → Page-head backdrops): not
 * while the tab is hidden, the frame is scrolled out of view, or the owner
 * asked for reduced motion. One watcher states it, so every animated
 * backdrop pauses for the same three reasons.
 */

export interface PlaybackWatch {
  /** Whether the animation should be running now. */
  readonly playing: () => boolean;
  readonly dispose: () => void;
}

/**
 * Watch `element` for the reasons to pause; `onChange` hears every change of
 * whether the animation should run, and is not called for a change that
 * leaves the answer as it was.
 */
export function watchPlayback(
  element: Element,
  reducedMotion: boolean,
  onChange: (playing: boolean) => void,
): PlaybackWatch {
  let visible = true;
  let last: boolean | null = null;
  const playing = () => !reducedMotion && !document.hidden && visible;
  const update = () => {
    const now = playing();
    if (now === last) return;
    last = now;
    onChange(now);
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting === true;
    update();
  });
  observer.observe(element);
  document.addEventListener("visibilitychange", update);
  return {
    playing,
    dispose: () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    },
  };
}
