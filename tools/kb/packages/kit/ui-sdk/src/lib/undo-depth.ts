/**
 * How many steps undo reaches back (DESIGN-UI.md → Undo): the one depth of
 * every undo ring the UI keeps — the page's writes (the graph store), a
 * canvas's documents and a row's text while it is edited. A ring at it
 * drops its oldest step as it takes a new one.
 */
export const UNDO_DEPTH = 200;
