/**
 * The code family's shared package (DESIGN.md → Extension families): its
 * ids, its view key and the settings it reads, how a code view says itself
 * in text and draws its page's snapshot, and the declaration and shared
 * plugin both hosts load. The sandbox it runs in, the grant's shape and the
 * engines are core (`@kb/sandbox`).
 */
export { CODE_IDS } from "./ids.ts";
export { CodeParams, CodeView, DEFAULT_GRANT, STARTER_CODE } from "./view.ts";
export { codeExtension, codePlugin } from "./extension.ts";
