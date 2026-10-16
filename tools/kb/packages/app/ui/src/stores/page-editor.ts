/**
 * The page's editor (`PageEditor`): the half of the page that holds a caret.
 * The shell binds every text host through it (`stores/node-text-port.ts`, the
 * shell's `NodeTextPort`), anchors the node palette on its focus, and lands
 * the caret after a write. Core names no editor; the projection the page
 * stands in provides its own while it is loaded (`PageEditorService`).
 */
import { EMPTY_EDITOR, type PageEditor, PageEditorService } from "@kb/ui-sdk";
import { followProvided, portSlot } from "@/stores/port-slot";

const installed = portSlot<PageEditor>(EMPTY_EDITOR);

/** The page's editor now: the installed one, else one with no focus whose verbs do nothing. */
export const pageEditor = installed.current;

/** Listen for a change to the editor's state, or to which editor is installed. */
export const subscribeEditor = installed.subscribe;

/** Install the page's editor: the one a plugin provides, or a test's stand-in. */
export const providePageEditor = installed.install;

/** Uninstall `editor`, if it is still the page's. */
function withdrawPageEditor(editor: PageEditor): void {
  installed.withdraw(editor);
}

// The editor a plugin provides is the one the page edits through.
followProvided(PageEditorService, providePageEditor, withdrawPageEditor);
