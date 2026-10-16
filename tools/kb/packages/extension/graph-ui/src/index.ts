/**
 * `@kb/graph-ui`: the graph family's browser half (DESIGN.md → Extension
 * families; DESIGN-UI.md → Field-based graph perspectives): the graph page,
 * its renderers, a node's neighbourhood, its sidebar section and the lens
 * extraction, which it also answers for other halves (`LensGraphService`).
 * It reaches the page only through `@kb/ui-sdk`'s `BrowserHost`. The page
 * loads its entry, `graphUiPlugin`, through `BROWSER_EXTENSIONS` under the
 * family's declared name, from the main bundle; the graph is optional and on
 * by default.
 */
export { graphUiPlugin } from "./plugin";

// What the page's own tests read of the graph (the graph page tests in
// `@kb/ui`, which run in the shell, and the shell's lens and ontology
// tests): the lens extraction and the renderer frame, which the entry loads
// already, and the 3D look's light arithmetic, checked against the shell's
// design-system sheets. Nothing here may pull a renderer into the entry's
// chunk (`ui-lazy-fence.test.ts`).
export { GLOW } from "./force3d-emphasis";
export { peakChannel, shadeNode, type NodeLighting, type Rgb } from "./force3d-light";
export type { GraphFrame } from "./graph-frame";
export { extractLensGraph, lensConfig, lensReport, parsePerspective } from "./graph-lens";
export { GRAPH_THEMES } from "./graph-themes";
