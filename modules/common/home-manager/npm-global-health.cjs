// Report the installed version only when all declared executable links work.
const { accessSync, constants } = require("node:fs");
const { join } = require("node:path");

const [prefix, name] = process.argv.slice(2);
try {
  const { version, bin } = require(join(prefix, "lib/node_modules", name, "package.json"));
  const binaries = typeof bin === "string" ? [name.split("/").at(-1)] : Object.keys(bin ?? {});
  console.log(version);
  for (const binary of binaries) {
    accessSync(join(prefix, "bin", binary), constants.X_OK);
  }
} catch {
  process.exitCode = 1;
}
