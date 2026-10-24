// Which threads keep a live kb frame in this window. bb unmounts a thread's panel tab whenever the thread is
// switched away from, so the frame cannot live in the tab: the window keeps one per recently shown thread
// (frames.tsx), and a thread shown again finds its kb tab as it left it, as a browser keeps a background tab.
// Pure, so the policy is tested on plain data.

/** How many threads keep a kb frame alive at once; each is a whole kb page with its query worker. */
export const MAX_KEPT_FRAMES = 3;

/**
 * The threads whose kb frame is alive, least recently shown first, and the order their frames were made in.
 * The two differ on purpose: a frame's element is never moved once made, since moving an iframe reloads it,
 * so the window draws frames in the order they were made and shows the one a thread's panel asks for.
 */
export class KeptFrames {
  readonly #limit: number;
  #recent: readonly string[] = [];
  #made: readonly string[] = [];

  constructor(limit = MAX_KEPT_FRAMES) {
    this.#limit = Math.max(1, limit);
  }

  /** The threads with a frame, in the order their frames were made. */
  get made(): readonly string[] {
    return this.#made;
  }

  /** Whether `threadId` has a live frame. */
  has(threadId: string): boolean {
    return this.#made.includes(threadId);
  }

  /**
   * `threadId`'s panel shows kb now: it keeps (or gets) a frame and becomes the most recently shown.
   * Returns the threads whose frames go to stay within the limit, least recently shown first; a thread
   * whose panel shows kb now is never one of them while another can go.
   */
  show(threadId: string, shownNow: ReadonlySet<string> = new Set()): readonly string[] {
    this.#recent = [...this.#recent.filter(id => id !== threadId), threadId];
    if (!this.#made.includes(threadId)) this.#made = [...this.#made, threadId];
    const evicted: string[] = [];
    while (this.#made.length > this.#limit) {
      const victim = this.#recent.find(id => id !== threadId && !shownNow.has(id) && !evicted.includes(id));
      if (victim === undefined) break;
      evicted.push(victim);
      this.#recent = this.#recent.filter(id => id !== victim);
      this.#made = this.#made.filter(id => id !== victim);
    }
    return evicted;
  }
}
