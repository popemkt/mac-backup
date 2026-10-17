/**
 * The graph themes the checks that hold every theme run over (the renderer
 * contract, the 3D scene contract, the label and node tests): what the theme
 * point holds once the family's theme plugin is loaded, read from a kernel
 * of their own, in contribution order. A theme a plugin contributes joins
 * them by its plugin being loaded here.
 */
import { Effect } from "effect";
import { makeKernel, syncPlugins } from "@kb/plugin";
import { GraphThemePoint, graphThemesPlugin, type GraphTheme } from "./graph-themes";

function contributedThemes(): readonly GraphTheme[] {
  const kernel = makeKernel();
  Effect.runSync(syncPlugins(kernel, [graphThemesPlugin]));
  return kernel.contributions(GraphThemePoint).map(({ value }) => value);
}

export const CONTRIBUTED_GRAPH_THEMES: readonly GraphTheme[] = contributedThemes();

/** The contributed theme `id` declares; a test naming one nobody contributes is wrong, so it throws. */
export function contributedTheme(id: string): GraphTheme {
  const theme = CONTRIBUTED_GRAPH_THEMES.find(({ key }) => key.id === id);
  if (theme === undefined) throw new Error(`no graph theme ${id} is contributed`);
  return theme;
}
