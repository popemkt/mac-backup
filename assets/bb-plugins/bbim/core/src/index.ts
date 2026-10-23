// @popemkt/bbim-core: vim-style keyboard navigation for any web page.
// The pure domain (./domain) runs anywhere; everything else needs a DOM.
export * from "./domain/index.ts";
export { type ActivateContext, activateElement, focusForTyping } from "./dom/activate.ts";
export { type Bbim, type BbimHooks, createBbim, type CreateBbimOptions } from "./dom/bbim.ts";
export { type CollectOptions, collectTargets, DEFAULT_SELECTORS, type LocalTarget } from "./dom/collect.ts";
export {
  deepActiveElement,
  editableGuard,
  type FocusGuard,
  type FocusState,
  focusState,
  isEditable,
  MENU_SELECTOR,
  MODAL_SELECTOR,
  presenceGuard,
  withinGuard,
} from "./dom/focus.ts";
export { frameTree, type OpaqueFrame } from "./dom/frames.ts";
export { type InputChoice, type InputField, inputFields, pickInput, preferredInput, TEXT_INPUT_SELECTOR } from "./dom/inputs.ts";
export { closestAcrossShadow, querySelectorDeep } from "./dom/tree.ts";
export { type HelpSection, type Theme, THEME_PROPERTIES, type ThemeProperty } from "./dom/overlay.ts";
export { type BridgeOptions, installBbimBridge } from "./bridge/bbim-bridge.ts";
