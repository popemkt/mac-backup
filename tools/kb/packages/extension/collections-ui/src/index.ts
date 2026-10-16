/**
 * `@kb/collections-ui`: the collections family's browser half (DESIGN.md →
 * Extension families; DESIGN-UI.md → Outline editor → frames): the table,
 * board and cards frame views, which lay a frame's rows out as a node set
 * inside the outline that hosts the frame and edits its rows. It reaches the
 * page only through `@kb/ui-sdk`: its `BrowserHost` and the frame's
 * `FrameSubject`. The page loads its entry, `collectionsUiPlugin`, through
 * `BROWSER_EXTENSIONS` under the family's declared name, from the main bundle.
 */
export { collectionsUiPlugin } from "./plugin";

// The views the outline's page tests in `@kb/ui` render, inside the outline's frame.
// GAP [[01M531QT1YPM9NTF6NKH9BP66S]]
export { BoardCardsView } from "./board-cards-view";
export { TableView } from "./table-view";
