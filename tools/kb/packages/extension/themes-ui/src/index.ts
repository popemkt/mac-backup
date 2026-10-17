/**
 * `@kb/themes-ui`: the themes family's browser half (DESIGN-UI.md → Design
 * tokens → Design systems): Paper and Terminal, each a sheet over layer 1,
 * contributed to `DesignSystemPoint` through `@kb/ui-sdk`, which the page's
 * painter adds and paints. The page loads its entry, `themesUiPlugin`,
 * through `BROWSER_EXTENSIONS` under the family's declared name.
 */
export { themesUiPlugin } from "./plugin";
