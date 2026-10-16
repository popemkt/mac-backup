import type { Plugin } from "@kb/plugin";
import { syncUiPlugins } from "@kb/ui-sdk";
import { browserHostUiPlugin } from "@/browser-host";

/**
 * Load `plugins` into the page's UI kernel behind the shell's host, as the
 * app loads its plugins (`ui-plugins.ts`): the kernel converges on exactly
 * these and the host, so a plugin that reaches the page through its host
 * applies. A test that means the host to be absent syncs the kernel itself.
 */
export function syncPagePlugins(plugins: readonly Plugin[]): void {
  syncUiPlugins([
    browserHostUiPlugin,
    ...plugins.filter((plugin) => plugin !== browserHostUiPlugin),
  ]);
}
