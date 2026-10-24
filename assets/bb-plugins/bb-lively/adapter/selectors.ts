// Every bb selector lively uses, and nowhere else. After a bb upgrade this is
// the one file to check: the settings page lists any selector that has not
// matched since the window loaded, and tests/selectors.test.ts runs the table
// against a captured bb DOM.
//
// Ratings (docs/research/2026-10-24-bb-theming-feasibility.md §1.5):
//   L  a supported API or design token
//   M  a hand-written bb data attribute, a library attribute (Radix, sonner)
//      or a plain element/role selector
//   H  DOM shape or utility classes (none ship on by default)
// `verified` is the bb version and how: "live" was matched in bb's web UI,
// "source" was read from bb's bundle but not on screen when checked.
import type { Targets } from "@popemkt/bb-lively-core";

export interface BbSelector {
  readonly id: string;
  readonly selector: string;
  readonly rating: "L" | "M" | "H";
  readonly verified: string;
  /** Where in bb it shows, so a person knows where to look before calling it broken. */
  readonly where: string;
  readonly purpose: string;
}

const LIVE = "0.46.1 live";
const SOURCE = "0.46.1 source";

const OVERLAY_CONTENT =
  '[data-radix-menu-content], [data-radix-popper-content-wrapper] > *, [role="dialog"], [role="alertdialog"], [role="listbox"], [data-slot="popover-content"]';

export const SELECTORS = {
  pressable: {
    selector: 'button, [role="button"], [data-sidebar="menu-button"]',
    rating: "M",
    verified: LIVE,
    where: "everywhere",
    purpose: "press: what sinks while pressed",
  },
  pressExclude: {
    selector:
      '[data-app-terminal], [data-panel-resize-hit-target], [data-vaul-handle], [data-sidebar-thread-shortcut-target], [aria-busy="true"], input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    rating: "M",
    verified: SOURCE,
    where: "terminal, resizers, drawers, thread-row drag handles",
    purpose: "press: never pressed (drag handles, resizers, fields)",
  },
  liftable: {
    selector: '[data-resource-detail-section], [data-testid="notification-row"]',
    rating: "M",
    verified: SOURCE,
    where: "notifications list, resource detail pages",
    purpose: "hoverLift: cards that rise",
  },
  rowList: {
    selector: "[data-timeline-row-list] > [data-timeline-items]",
    rating: "M",
    verified: LIVE,
    where: "an open thread",
    purpose: "listEnter: the timeline whose rows can arrive",
  },
  row: {
    selector: "[data-timeline-row-id][data-index]",
    rating: "M",
    verified: LIVE,
    where: "an open thread",
    purpose: "listEnter: one timeline row (id and virtualized index)",
  },
  focusBox: {
    selector: "form[data-promptbox]",
    rating: "M",
    verified: LIVE,
    where: "the composer",
    purpose: "focusRing: the composer box that glows",
  },
  sendButton: {
    selector: "[data-promptbox-submit-action]",
    rating: "M",
    verified: LIVE,
    where: "the composer",
    purpose: "sendPulse: the button that ripples",
  },
  sendIcon: {
    selector: "[data-promptbox-submit-action] > [data-icon-root]",
    rating: "M",
    verified: LIVE,
    where: "the composer",
    purpose: "sendPulse: the Send/Stop icon that pops as it swaps",
  },
  threadRow: {
    selector: "[data-sidebar-thread-id]",
    rating: "M",
    verified: LIVE,
    where: "the sidebar thread list",
    purpose: "statusPulse: finds a thread's row by its id",
  },
  statusRow: {
    selector: "[data-parent-card]",
    rating: "M",
    verified: LIVE,
    where: "the sidebar thread list",
    purpose: "statusPulse: the row card that rings (already positioned)",
  },
  toast: {
    selector: "[data-sonner-toast]",
    rating: "M",
    verified: SOURCE,
    where: "a notification toast (archive a thread to see one)",
    purpose: "toastSpring: sonner's toast",
  },
  overlayOpen: {
    selector: `:is(${OVERLAY_CONTENT})[data-state="open"]`,
    rating: "M",
    verified: LIVE,
    where: "an open menu, popover or dialog",
    purpose: "overlayEnter: retimes their enter",
  },
  overlayClosed: {
    selector: `:is(${OVERLAY_CONTENT})[data-state="closed"]`,
    rating: "M",
    verified: SOURCE,
    where: "a menu or dialog while it closes",
    purpose: "overlayEnter: retimes their exit",
  },
  switchThumb: {
    selector: 'button[role="switch"] > span',
    rating: "M",
    verified: SOURCE,
    where: "Settings (any on/off switch)",
    purpose: "toggles: the switch thumb (Radix structure: the thumb is the switch's span)",
  },
  checkbox: {
    selector: '[role="checkbox"]',
    rating: "M",
    verified: SOURCE,
    where: "Settings and pickers with checkboxes",
    purpose: "toggles: the checkbox that pops",
  },
  hostAnimation: {
    selector: '[class*="animate-in"], [class*="animate-out"]',
    rating: "M",
    verified: LIVE,
    where: "any open menu or dialog",
    purpose: "calmHost: bb's own enter/exit animations (tw-animate)",
  },
} as const satisfies Record<string, Omit<BbSelector, "id">>;

export type SelectorId = keyof typeof SELECTORS;

/** The table as rows, for the canary and the settings page. */
export const SELECTOR_TABLE: ReadonlyArray<BbSelector> = Object.entries(SELECTORS).map(
  ([id, entry]): BbSelector => Object.assign({ id }, entry),
);

/** bbim (assets/bb-plugins/bbim) sets this on <html> while its hints or a picker show. */
export const BBIM_ACTIVE = "data-bbim-active";

/** The attributes on a timeline row (bb's virtualizer writes `data-index`). */
export const ROW_ID_ATTRIBUTE = "data-timeline-row-id";
export const ROW_INDEX_ATTRIBUTE = "data-index";
/** The attribute on a sidebar thread row's link holding the thread id. */
export const THREAD_ID_ATTRIBUTE = "data-sidebar-thread-id";

export const BB_TARGETS: Targets = {
  pressable: SELECTORS.pressable.selector,
  pressExclude: SELECTORS.pressExclude.selector,
  liftable: SELECTORS.liftable.selector,
  rowList: SELECTORS.rowList.selector,
  row: SELECTORS.row.selector,
  rowIdAttribute: ROW_ID_ATTRIBUTE,
  rowIndexAttribute: ROW_INDEX_ATTRIBUTE,
  focusBox: SELECTORS.focusBox.selector,
  sendButton: SELECTORS.sendButton.selector,
  sendIcon: SELECTORS.sendIcon.selector,
  statusRow: SELECTORS.statusRow.selector,
  toast: SELECTORS.toast.selector,
  overlayOpen: SELECTORS.overlayOpen.selector,
  overlayClosed: SELECTORS.overlayClosed.selector,
  switchThumb: SELECTORS.switchThumb.selector,
  checkbox: SELECTORS.checkbox.selector,
  hostAnimation: SELECTORS.hostAnimation.selector,
  suspendOn: [BBIM_ACTIVE],
};
