// What a host tells lively about its DOM: one CSS selector per role. The core
// animates roles and never names a host element itself; a host (bb's adapter)
// keeps all of its selectors in one table and builds this from it.

export interface Targets {
  /** Things that sink when pressed (buttons, button-like rows). */
  readonly pressable: string;
  /** Never pressed even when `pressable` matches: drag handles, resizers, inputs, a terminal. */
  readonly pressExclude: string;
  /** Cards that rise under the pointer. */
  readonly liftable: string;
  /** A list whose direct children are rows that can arrive (a chat timeline). */
  readonly rowList: string;
  /** A row of `rowList`. */
  readonly row: string;
  /** The attribute holding a row's stable id. */
  readonly rowIdAttribute: string;
  /** The attribute holding a row's position in the whole list (a virtualized index). */
  readonly rowIndexAttribute: string;
  /** The input box that glows while focused; must already be positioned. */
  readonly focusBox: string;
  /** The send button that ripples on a send. */
  readonly sendButton: string;
  /** The send button's icon, which pops when it swaps (Send ↔ Stop). */
  readonly sendIcon: string;
  /**
   * Inside `focusBox`, the box the person's words show in (it may scroll): the
   * send copies what it shows the moment before it is sent, to see the words off.
   */
  readonly composerText: string;
  /** A `row` holding the person's own message (a send's echo lands as one). */
  readonly sentRow: string;
  /** A `row` holding the agent's reply (the first of a turn arrives like the send). */
  readonly replyRow: string;
  /** Inside a `row`, the message's own box: where a send's path ends and its art sits. */
  readonly bubble: string;
  /** A status row that can pulse; must already be positioned. */
  readonly statusRow: string;
  /** A toast whose transform transition gets a spring. */
  readonly toast: string;
  /** Menus, popovers, dialogs while open, animated by the host's own `enter` keyframes. */
  readonly overlayOpen: string;
  /** The large overlays among `overlayOpen` (dialogs): they tilt half as much under the wobbly style. */
  readonly dialogOpen: string;
  /** The same while closing (the host's `exit` keyframes). */
  readonly overlayClosed: string;
  /** A switch's moving thumb. */
  readonly switchThumb: string;
  /** A checkbox, which pops when ticked. */
  readonly checkbox: string;
  /** A page or panel view that mounts fresh on navigation (a thread's window); it eases in on mount. */
  readonly pageView: string;
  /**
   * A sidebar a preset's art can paint behind (with `pageView`, the art
   * surfaces): it must have an opaque background and no descendant positioned
   * against an outer box, since art positions and isolates it.
   */
  readonly sidebar: string;
  /**
   * The band the composer docks in at the bottom of a thread, opaque, inside
   * a `pageView`. A preset's backdrop art repeats on it, so the art runs to the
   * bottom edge; it must already be positioned. Its edges may stop short of the
   * view's (a scrollbar between them): its art reaches the view's corner (reach.ts).
   */
  readonly dock: string;
  /** The host's fade over the timeline's bottom edge, just above the dock; hidden under backdrop art. */
  readonly dockFade: string;
  /**
   * A request waiting for the person inside a page view (an approval, a
   * question, a plan to review): while one is present, turnFreeze freezes the
   * view's timeline (`rowList`) and lights the request up. It must sit outside
   * `rowList`, so the freeze never dims the request itself.
   */
  readonly pendingRequest: string;
  /** The host's "agent is working" line, which breathes a glow while present. */
  readonly working: string;
  /** The host's own enter/exit animations, stopped by `calmHost` under reduced motion. */
  readonly hostAnimation: string;
  /**
   * Root-element attributes that pause lively while present: another layer
   * (bbim's hints) is measuring where things are and needs them still.
   */
  readonly suspendOn: ReadonlyArray<string>;
}
