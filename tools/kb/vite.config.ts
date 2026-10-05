import { defineConfig, type UserConfig } from "vite-plus";
import formatter from "./.oxfmtrc.json";

/** Vite+ owns invocation; the existing formatter file owns its settings. */
export default defineConfig({ fmt: formatter as NonNullable<UserConfig["fmt"]> });
