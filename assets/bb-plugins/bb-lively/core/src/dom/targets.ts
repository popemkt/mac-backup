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
  /** A status row that can pulse; must already be positioned. */
  readonly statusRow: string;
  /** A toast whose transform transition gets a spring. */
  readonly toast: string;
  /** Menus, popovers, dialogs while open, animated by the host's own `enter` keyframes. */
  readonly overlayOpen: string;
  /** The same while closing (the host's `exit` keyframes). */
  readonly overlayClosed: string;
  /** A switch's moving thumb. */
  readonly switchThumb: string;
  /** A checkbox, which pops when ticked. */
  readonly checkbox: string;
  /** The host's own enter/exit animations, stopped by `calmHost` under reduced motion. */
  readonly hostAnimation: string;
  /**
   * Root-element attributes that pause lively while present: another layer
   * (bbim's hints) is measuring where things are and needs them still.
   */
  readonly suspendOn: ReadonlyArray<string>;
}
