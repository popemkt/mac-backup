/**
 * The docs family's shared package (DESIGN.md → Extension families): its
 * declaration, the one home of its name. The server entry (`@kb/ext-docs`)
 * reads it, and the bundled list (`@kb/bundled`) folds it.
 */
import { defineExtension } from "@kb/contracts";

export const docsExtension = defineExtension({ name: "docs", label: "Docs" });
