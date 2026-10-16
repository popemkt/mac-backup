/**
 * The collections family's shared package (DESIGN.md → Extension families):
 * its view keys, its declaration and the shared plugin both hosts build their
 * entries from. The browser half is `@kb/collections-ui`.
 */
export { collectionsExtension, collectionsPlugin } from "./extension.ts";
export { CollectionBoardView, CollectionCardsView, CollectionTableView } from "./view.ts";
