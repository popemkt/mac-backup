/**
 * The graph's theme point (DESIGN-UI.md → Graph → Graph themes), held over
 * every contributed theme: the graph family's own and a plugin's of the
 * test's own, declared on a family of its own as declared options of the
 * graph's theme kind. Each is declared, so its option is seeded under
 * `lens.theme` and labelled; it is contributed under that key; `lens.theme`
 * chooses it by its option; and a choice nobody contributes now (an
 * unknown id, a plugin unloaded) draws the default. How each renderer draws
 * a theme is the renderer contract's, run over the same themes.
 */
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { BUNDLED_DECLARATIONS } from "@kb/bundled";
import { declarationPlugin, defineExtension } from "@kb/contracts";
import { decodeLensConfig, GRAPH_THEME_OPTIONS, type LensTheme } from "@kb/graph";
import { declaredOptionId, foldSeed, type SeedOption } from "@kb/model";
import { definePlugin, makeKernel, syncPlugins, type Plugin } from "@kb/plugin";
import { provideDeclared } from "@kb/ui-sdk";
import { CONTRIBUTED_GRAPH_THEMES, contributedTheme } from "./contributed-themes";
import {
  DEFAULT_GRAPH_THEME,
  GraphThemePoint,
  graphThemesPlugin,
  shownGraphTheme,
  type GraphTheme,
} from "./graph-themes";

const NEON_KEY: SeedOption = { id: "plain.neon", label: "Neon" };
/** A family of the test's own: it declares a graph theme, and its page plugin contributes it. */
const plainExtension = defineExtension({
  name: "plain",
  label: "Plain",
  declaredOptions: [{ kind: GRAPH_THEME_OPTIONS, options: [NEON_KEY] }],
});
const NEON: GraphTheme = { ...contributedTheme("cel"), key: NEON_KEY };
const plainPlugin = definePlugin({
  name: "plain",
  apply: (ctx) =>
    Effect.all(
      [
        ctx.plugin(declarationPlugin(plainExtension)),
        ctx.contribute(GraphThemePoint, provideDeclared(NEON)),
      ],
      { discard: true },
    ),
});

/** The themes `plugins` contribute, read from a kernel of their own. */
function contributedBy(plugins: readonly Plugin[]) {
  const kernel = makeKernel();
  Effect.runSync(syncPlugins(kernel, plugins));
  return kernel.contributions(GraphThemePoint);
}

const PAGE = contributedBy([graphThemesPlugin, plainPlugin]);
const THEMES = PAGE.map(({ value }) => value);
const SEED = new Map(
  foldSeed([...BUNDLED_DECLARATIONS, plainExtension]).nodes.map((node) => [node.id, node]),
);

/** The theme a node's `lens.theme` prop chooses among `contributed`, as a renderer draws it. */
function themeOf(props: Parameters<typeof decodeLensConfig>[0], contributed = PAGE): GraphTheme {
  const theme: LensTheme = decodeLensConfig(props, () => {}).theme;
  return shownGraphTheme(contributed, theme);
}

const choosing = (id: string) => ({
  [GRAPH_THEME_OPTIONS.field]: [
    { t: "ref" as const, v: declaredOptionId(GRAPH_THEME_OPTIONS, id) },
  ],
});

describe("the graph's theme point", () => {
  it("holds the family's themes, matte first, and a plugin's own", () => {
    expect(CONTRIBUTED_GRAPH_THEMES[0]).toBe(DEFAULT_GRAPH_THEME);
    expect(THEMES.map(({ key }) => key.id)).toEqual([
      ...CONTRIBUTED_GRAPH_THEMES.map(({ key }) => key.id),
      NEON_KEY.id,
    ]);
  });

  describe.each(THEMES.map((theme) => [theme.key.id, theme] as const))("%s", (id, theme) => {
    it("is declared: its option is seeded under lens.theme, labelled", () => {
      const option = declaredOptionId(GRAPH_THEME_OPTIONS, id);
      expect(SEED.get(GRAPH_THEME_OPTIONS.field)?.children).toContain(option);
      expect(SEED.get(option)?.text).toBe(theme.key.label);
    });

    it("is chosen by lens.theme naming its option", () => {
      expect(themeOf(choosing(id))).toBe(theme);
    });
  });

  it("reads a theme a definition holds as a string, as one written before the options were nodes", () => {
    expect(themeOf({ [GRAPH_THEME_OPTIONS.field]: [{ t: "str", v: "glass" }] })).toBe(
      contributedTheme("glass"),
    );
  });

  it("draws the default for no choice, an unknown id, and a theme whose plugin is unloaded", () => {
    expect(themeOf({})).toBe(DEFAULT_GRAPH_THEME);
    expect(themeOf(choosing("plain.gone"))).toBe(DEFAULT_GRAPH_THEME);
    const unloaded = contributedBy([graphThemesPlugin]);
    expect(themeOf(choosing(NEON_KEY.id), unloaded)).toBe(DEFAULT_GRAPH_THEME);
  });

  it("draws the default where nothing is contributed", () => {
    expect(themeOf(choosing("cube"), [])).toBe(DEFAULT_GRAPH_THEME);
  });
});
