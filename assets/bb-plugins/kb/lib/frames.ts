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

/** A store as the panel knows it: its name, and the page it frames (null: tools only). */
export type StoreView = { readonly name: string; readonly page: string | null };

/** What the backend said the panel can show. */
export type StoresConfig = { readonly stores: readonly StoreView[]; readonly defaultStore: string | null };

/** A thread's kb tab as its agent sees it: the store the panel shows, and its tab session once the frame says it. */
export type PanelTab = { readonly store: string; readonly session: string | null };

/**
 * Each thread's kb tab in this window: the store its panel shows, and the session the frame showing that store
 * said. The store is the person's choice and holds from the moment they make it, frame loaded or not, so an
 * agent's call that names no store goes to the store the panel says. A session belongs to one frame (its store,
 * page and generation, `frameOf`): a session from any other frame, an older one or one for another store or
 * page, is never paired with what the panel shows now.
 */
export class ThreadTabs {
  #config: StoresConfig = { stores: [], defaultStore: null };
  /** The store each thread's panel chose; a thread absent here shows the default store. */
  readonly #chosen = new Map<string, string>();
  /** Bumped to load a thread's frame again from scratch. */
  readonly #generations = new Map<string, number>();
  /** The session each thread's frame said, with the frame that said it. */
  readonly #sessions = new Map<string, { readonly session: string; readonly frame: string }>();

  get config(): StoresConfig {
    return this.#config;
  }

  /** The stores changed: each thread shows what its choice, or the default, now names. */
  configure(config: StoresConfig): void {
    this.#config = config;
  }

  /** The store `threadId`'s panel shows: the one it chose while that is configured, else the default. */
  storeOf(threadId: string): StoreView | null {
    const { stores, defaultStore } = this.#config;
    const chosen = this.#chosen.get(threadId);
    return stores.find(s => s.name === chosen) ?? stores.find(s => s.name === defaultStore) ?? stores[0] ?? null;
  }

  generationOf(threadId: string): number {
    return this.#generations.get(threadId) ?? 0;
  }

  /**
   * The frame `threadId`'s panel shows now: its generation, store and page. A frame is made for each, so a new
   * store, a new page or a reload is a new frame; null while the panel has no store.
   */
  frameOf(threadId: string): string | null {
    const store = this.storeOf(threadId);
    return store === null ? null : `${this.generationOf(threadId)} ${store.name} ${store.page ?? ""}`;
  }

  /** The panel shows store `name` now. False when it already did. */
  choose(threadId: string, name: string): boolean {
    if (this.storeOf(threadId)?.name === name) return false;
    this.#chosen.set(threadId, name);
    return true;
  }

  /** Load `threadId`'s frame again from scratch: a new frame, with no session until it says one. */
  reload(threadId: string): void {
    this.#generations.set(threadId, this.generationOf(threadId) + 1);
    this.#sessions.delete(threadId);
  }

  /** Frame `frame` of `threadId` said its session. Kept only while that frame is the one shown. */
  setSession(threadId: string, frame: string, session: string): boolean {
    if (frame !== this.frameOf(threadId)) return false;
    this.#sessions.set(threadId, { session, frame });
    return true;
  }

  /** The session of the frame `threadId`'s panel shows now, once that frame said it. */
  sessionOf(threadId: string): string | null {
    const held = this.#sessions.get(threadId);
    return held !== undefined && held.frame === this.frameOf(threadId) ? held.session : null;
  }

  /** `threadId`'s tab for its agent: the store shown, and its session when known. */
  tab(threadId: string): PanelTab | null {
    const store = this.storeOf(threadId);
    return store === null ? null : { store: store.name, session: this.sessionOf(threadId) };
  }

  forget(threadId: string): void {
    this.#chosen.delete(threadId);
    this.#generations.delete(threadId);
    this.#sessions.delete(threadId);
  }
}
