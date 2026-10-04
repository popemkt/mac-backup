/**
 * `@kb/canvas-ui`: the canvas family's browser half (DESIGN.md → Extension
 * families; DESIGN-UI.md → Canvas): the canvas list and one canvas, their
 * routes and sidebar section, drawn in 2D as DOM cards over SVG edges and in
 * 3D on the scene kit. It reaches the page only through `@kb/ui-sdk`'s
 * `BrowserHost` and the scene kit. The page loads its entry, `canvasUiPlugin`,
 * through `BROWSER_EXTENSIONS` under the family's declared name, from the
 * main bundle; each page and the 3D projection are chunks of their own.
 */
export { canvasUiPlugin } from "./plugin";
