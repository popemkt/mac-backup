/**
 * The backdrops family's shared package (DESIGN.md → Extension families;
 * DESIGN-UI.md → Page-head backdrops): its declaration and the shared plugin
 * both hosts build their entries from. The backdrops themselves are page
 * ambience, so they live in the browser half, `@kb/backdrops-ui`.
 */
export {
  GRADIENT_BACKDROP,
  SKY_BACKDROP,
  UNICORN_BACKDROP,
  backdropsExtension,
  backdropsPlugin,
} from "./extension.ts";
