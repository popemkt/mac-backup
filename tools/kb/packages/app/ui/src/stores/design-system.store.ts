/**
 * The design system the page is painted in (DESIGN-UI.md → Design tokens →
 * Design systems): the contributed one the choice names, else the first
 * contributed, core's default (`chosenDeclared`), so a stale or unknown id
 * paints the default.
 *
 * The painter is the one owner of `<html data-theme>` and of the design
 * systems' sheets on the page. It adds every contributed system's sheet,
 * since Preferences' swatches are live samples of each, after every sheet
 * already on the page, so a system's blocks beat layer 1's; it drops the
 * sheet of a system nobody contributes any more; and it crossfades a change
 * of system like a change of theme.
 *
 * It records what it painted, the id and its sheet, in
 * `localStorage["kb-design-system"]`, which the blocking script in
 * `index.html` paints before first paint, so a non-default system does not
 * flash the default while the page boots. The record is derived from the
 * last paint and is never read as the choice.
 */
import { create } from "zustand";
import type { Contribution } from "@kb/plugin";
import {
  chosenDeclared,
  currentContributions,
  DesignSystemPoint,
  subscribeUiKernel,
  type DesignSystem,
} from "@kb/ui-sdk";
import { transitionTheme } from "@/lib/theme-transition";
import { usePrefsStore } from "@/stores/prefs.store";

export const PAINTED_STORAGE_KEY = "kb-design-system";
/** The attribute that names the system a `<style>` element is the sheet of. */
export const SHEET_ATTRIBUTE = "data-design-system";

interface DesignSystemState {
  /** The id `<html data-theme>` carries; empty while nothing has painted it. */
  readonly painted: string;
}

export const useDesignSystemStore = create<DesignSystemState>(() => ({
  painted:
    typeof document === "undefined"
      ? ""
      : (document.documentElement.getAttribute("data-theme") ?? ""),
}));

/** The contribution the choice names among `contributed`. */
function shownIn(
  contributed: readonly Contribution<DesignSystem>[],
): Contribution<DesignSystem> | null {
  return chosenDeclared(contributed, usePrefsStore.getState().designSystem);
}

/** The sheet elements the painter has placed last in `<head>`. */
const placed = new WeakSet<Element>();

/**
 * One `<style>` per contributed system that has a sheet, holding it, and
 * none for a system no longer contributed. An element is moved last in
 * `<head>` once, when the painter first meets it (the boot record's
 * included), so a sheet the bundler added meanwhile cannot follow it.
 */
function syncSheets(contributed: readonly Contribution<DesignSystem>[]): void {
  const head = document.head;
  const sheets = new Map(
    contributed
      .filter(({ value }) => value.stylesheet !== "")
      .map(({ value }) => [value.key.id, value.stylesheet] as const),
  );
  const present = new Map<string, Element>();
  for (const element of head.querySelectorAll(`style[${SHEET_ATTRIBUTE}]`)) {
    const id = element.getAttribute(SHEET_ATTRIBUTE) ?? "";
    if (sheets.has(id) && !present.has(id)) present.set(id, element);
    else element.remove();
  }
  for (const [id, sheet] of sheets) {
    const element = present.get(id) ?? document.createElement("style");
    element.setAttribute(SHEET_ATTRIBUTE, id);
    if (element.textContent !== sheet) element.textContent = sheet;
    if (!placed.has(element)) {
      head.appendChild(element);
      placed.add(element);
    }
  }
}

let recorded: string | null = null;

/** Record the paint for the next boot; a write that fails leaves the boot to paint the default. */
function record(system: DesignSystem): void {
  const next = JSON.stringify({ id: system.key.id, stylesheet: system.stylesheet });
  if (next === recorded) return;
  recorded = next;
  try {
    localStorage.setItem(PAINTED_STORAGE_KEY, next);
  } catch {
    // Quota / private mode: the next boot paints the default until the page does.
  }
}

let booted = false;

/** Paint the page in the system shown now, with every contributed sheet on it. */
function paint(): void {
  if (typeof document === "undefined") return;
  const contributed = currentContributions(DesignSystemPoint);
  syncSheets(contributed);
  const shown = shownIn(contributed);
  // Nothing contributed yet: what the boot record painted stands.
  if (shown === null) return;
  record(shown.value);
  const { id } = shown.value.key;
  const root = document.documentElement;
  const changes = root.getAttribute("data-theme") !== id;
  const apply = () => {
    root.setAttribute("data-theme", id);
    useDesignSystemStore.setState({ painted: id });
  };
  if (!booted) {
    booted = true;
    apply();
  } else if (changes || useDesignSystemStore.getState().painted !== id) {
    transitionTheme(apply, changes);
  }
}

/**
 * Keep the page painted in the shown system: on every change to the page's
 * contributions or to the choice. Paints once now. Returns the unsubscribe.
 */
export function startDesignSystems(): () => void {
  const unsubscribeKernel = subscribeUiKernel(paint);
  const unsubscribePrefs = usePrefsStore.subscribe((next, previous) => {
    if (next.designSystem !== previous.designSystem) paint();
  });
  paint();
  return () => {
    unsubscribeKernel();
    unsubscribePrefs();
  };
}
