/**
 * The plugins the UI ships with. The shell loads them into the UI kernel
 * before it renders; each owns its pages and sidebar section, and nothing in
 * the shell names any of them again.
 */
import type { Plugin } from "@kb/plugin";
import { canvasUiPlugin } from "@/components/canvas/plugin";
import { graphUiPlugin } from "@/components/graph/plugin";
import { ontologyUiPlugin } from "@/components/ontology/plugin";
import { outlineUiPlugin } from "@/components/outline/plugin";
import { loadUiPlugins } from "@/lib/plugins";

export const BUILTIN_UI_PLUGINS: readonly Plugin[] = [
  outlineUiPlugin,
  graphUiPlugin,
  ontologyUiPlugin,
  canvasUiPlugin,
];

export function loadBuiltinUiPlugins(): void {
  loadUiPlugins(BUILTIN_UI_PLUGINS);
}
