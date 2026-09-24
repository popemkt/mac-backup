/**
 * The device-level appearance vocabulary: the value sets themselves, so both
 * the store that persists them and the leaf modules that read them name one
 * declaration rather than two copies.
 */
export const THEMES = ["light", "dark", "system"] as const;
export type ThemePref = (typeof THEMES)[number];

export const WIDTHS = ["centered", "full"] as const;
export type WidthPref = (typeof WIDTHS)[number];

/**
 * The design systems (DESIGN-UI.md → Design tokens → Design systems), in
 * picker order, the default first. Each id other than the default names one
 * stylesheet, `design-systems/<id>.css`, whose blocks override layer 1 under
 * `[data-theme="<id>"]`; the default is layer 1 itself. `design-systems.test.ts`
 * holds this list and those stylesheets to each other.
 */
export const DESIGN_SYSTEM_IDS = ["kb", "paper", "terminal"] as const;
export type DesignSystemId = (typeof DESIGN_SYSTEM_IDS)[number];
export const DEFAULT_DESIGN_SYSTEM: DesignSystemId = "kb";

/** What the picker calls each one; a Record, so an id without a label does not compile. */
const DESIGN_SYSTEM_LABELS: Record<DesignSystemId, string> = {
  kb: "kb",
  paper: "Paper",
  terminal: "Terminal",
};

export interface DesignSystem {
  readonly id: DesignSystemId;
  readonly label: string;
}

export const DESIGN_SYSTEMS: readonly DesignSystem[] = DESIGN_SYSTEM_IDS.map((id) => ({
  id,
  label: DESIGN_SYSTEM_LABELS[id],
}));
