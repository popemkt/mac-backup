/**
 * The design system the page is painted in (DESIGN-UI.md → Design tokens →
 * Design systems): the contributed one core's setting chooses
 * (`sys.f.design-system`, `shownDesignSystem`), else the first contributed,
 * core's default, so a stale or unknown choice paints the default.
 *
 * The painter is the one owner of `<html data-theme>` and of the design
 * systems' sheets on the page. It adds every contributed system's sheet,
 * since Preferences' swatches are live samples of each, after every sheet
 * already on the page, so a system's blocks beat layer 1's; it drops the
 * sheet of a system nobody contributes any more; and it crossfades a change
 * of system like a change of theme, whoever writes the setting.
 *
 * It records what it painted, the id and its sheet, in
 * `localStorage["kb-design-system"]`, which the blocking script in
 * `index.html` paints before first paint, so a non-default system does not
 * flash the default while the page boots and the graph loads. The record is
 * derived from the last paint and is never read as the choice.
 */
import { create } from "zustand";
import { extensionNodeId } from "@kb/model";
import type { Contribution } from "@kb/plugin";
import {
  currentContributions,
  DesignSystemPoint,
  shownDesignSystem,
  subscribeUiKernel,
  type DesignSystem,
} from "@kb/ui-sdk";
import { transitionTheme } from "@/lib/theme-transition";
import { useGraphStore } from "@/stores/graph.store";

export const PAINTED_STORAGE_KEY = "kb-design-system";
/** The attribute that names the system a `<style>` element is the sheet of. */
export const SHEET_ATTRIBUTE = "data-design-system";

const CORE = extensionNodeId("core");

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

/** The contribution core's setting chooses among `contributed`, as the graph holds it now. */
function shownIn(
  contributed: readonly Contribution<DesignSystem>[],
): Contribution<DesignSystem> | null {
  return shownDesignSystem(contributed, useGraphStore.getState().index?.getNode(CORE)?.props);
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

/** Record the paint for the next boot; a write that fails leaves the boot to paint the default. */
function record(system: DesignSystem): void {
  try {
    localStorage.setItem(
      PAINTED_STORAGE_KEY,
      JSON.stringify({ id: system.key.id, stylesheet: system.stylesheet }),
    );
  } catch {
    // Quota / private mode: the next boot paints the default until the page does.
  }
}

let booted = false;
/** The system last painted, as contributed: the same object until the choice or the kernel moves. */
let shownLast: DesignSystem | null = null;

/**
 * Paint the page in the system shown now; nothing when it is the one already
 * painted. Until the graph has arrived the choice is unknown, so what the
 * boot record painted stands rather than the default.
 */
function show(contributed: readonly Contribution<DesignSystem>[]): void {
  if (useGraphStore.getState().index === null) return;
  const shown = shownIn(contributed);
  if (shown === null || shown.value === shownLast) return;
  shownLast = shown.value;
  record(shown.value);
  const { id } = shown.value.key;
  const root = document.documentElement;
  const apply = () => {
    root.setAttribute("data-theme", id);
    useDesignSystemStore.setState({ painted: id });
  };
  if (booted) transitionTheme(apply, root.getAttribute("data-theme") !== id);
  else {
    booted = true;
    apply();
  }
}

/**
 * The page's contributions moved: every contributed sheet on the page, then
 * the system shown. Core contributes its default whenever its plugins are
 * loaded, so nothing contributed means they are not yet: the boot record's
 * sheet stands.
 */
function paint(): void {
  if (typeof document === "undefined") return;
  const contributed = currentContributions(DesignSystemPoint);
  if (contributed.length === 0) return;
  syncSheets(contributed);
  show(contributed);
}

/**
 * Keep the page painted in the shown system: its sheets on every change to
 * the page's contributions, and the system on those and on every change to
 * the graph, which holds core's setting. Paints once now. Returns the
 * unsubscribe.
 */
export function startDesignSystems(): () => void {
  const unsubscribeKernel = subscribeUiKernel(paint);
  const unsubscribeGraph = useGraphStore.subscribe(() => {
    if (typeof document !== "undefined") show(currentContributions(DesignSystemPoint));
  });
  paint();
  return () => {
    unsubscribeKernel();
    unsubscribeGraph();
  };
}
