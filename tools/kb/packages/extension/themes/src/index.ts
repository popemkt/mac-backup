/**
 * The themes family's shared package (DESIGN.md → Extension families;
 * DESIGN-UI.md → Design tokens → Design systems): its declaration and the
 * shared plugin both hosts build their entries from. The design systems
 * themselves are page stylesheets, so they live in the browser half,
 * `@kb/themes-ui`.
 */
export {
  PAPER_DESIGN_SYSTEM,
  TERMINAL_DESIGN_SYSTEM,
  themesExtension,
  themesPlugin,
} from "./extension.ts";
