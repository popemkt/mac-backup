/**
 * `@kb/backdrops-ui`: the backdrops family's browser half (DESIGN-UI.md →
 * Page-head backdrops): the tint and the Unicorn Studio scene, contributed
 * to `BackdropPoint` through `@kb/ui-sdk`, which every page head renders
 * through its one slot. The page loads its entry, `backdropsUiPlugin`,
 * through `BROWSER_EXTENSIONS` under the family's declared name.
 */
export { backdropsUiPlugin } from "./plugin";
