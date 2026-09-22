import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// A self-contained distribution lets another workspace use the Promise API
// without adopting kb's workspace layout or its internal Effect version.
const packageRoot = resolve(import.meta.dir, "..");
const outdir = resolve(packageRoot, "../../..", "out/client");
mkdirSync(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(packageRoot, "src/index.ts")],
  outdir,
  target: "bun",
});
if (!result.success) throw new AggregateError(result.logs, "kb client build failed");
copyFileSync(resolve(packageRoot, "src/api.d.ts"), resolve(outdir, "index.d.ts"));
writeFileSync(
  resolve(outdir, "package.json"),
  JSON.stringify(
    {
      name: "@kb/client",
      version: "0.0.0",
      private: true,
      type: "module",
      exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
    },
    null,
    2,
  ) + "\n",
);
