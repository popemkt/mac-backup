/**
 * Views as data: the option node that names a view in the store.
 *
 * A view's key lives with the plugin that provides it (`@kb/ui`); what the
 * store needs of it is only its name, so the option id derives from the view
 * id and nothing else. DESIGN.md → Kinds, roles and options → View nodes is
 * the statement of the model.
 */

/** The option node that names the view `<namespace>.<local id>` in data. */
export function viewOptionId(viewId: string): string {
  return `sys.view.${viewId}`;
}
