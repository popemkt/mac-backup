// Proves a plugin's store copy (./source.nix) is complete: every relative
// import in its source, CSS @import and tsconfig "include" entry resolves inside the copy.
// Usage: node check-imports.mjs <copy>/<plugin> ...; exits 1 listing misses.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SKIPPED = new Set(["node_modules", "dist"]);
const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;
const SPECIFIERS = [
  /\b(?:import|export)\b[^'";]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g,
  // Not a JSDoc type, {import('…').T}, which loads nothing: a tldraw
  // pattern types its script against the canvas workspace it is copied into.
  /(?<!\{)\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  /^\s*import\s+["'](\.{1,2}\/[^"']+)["']/gm,
];
const CSS_IMPORT = /@import\s+(?:url\()?["'](\.{1,2}\/[^"']+)["']/g;

const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (SKIPPED.has(e.name) ? [] : walk(join(dir, e.name))) : [join(dir, e.name)],
  );

const resolves = target => {
  const bases = [target];
  if (/\.(js|mjs)$/.test(target)) bases.push(target.replace(/\.m?js$/, ".ts"), target.replace(/\.m?js$/, ".tsx"));
  const exts = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", ".json", ".d.ts", ".css"];
  return bases.some(
    b =>
      exts.some(x => existsSync(b + x) && statSync(b + x).isFile()) ||
      ["index.ts", "index.tsx", "index.d.ts", "index.js"].some(i => existsSync(join(b, i))),
  );
};

let misses = 0;
for (const pluginDir of process.argv.slice(2)) {
  const root = dirname(resolve(pluginDir));
  const miss = (file, spec, why) => {
    misses++;
    console.error(`${relative(root, file)}: ${spec} ${why}`);
  };
  const check = (file, spec) => {
    const target = resolve(dirname(file), spec);
    if (relative(root, target).startsWith("..")) miss(file, spec, "leaves the copy");
    else if (!resolves(target)) miss(file, spec, "is not in the copy");
  };
  for (const file of walk(resolve(pluginDir))) {
    if (SOURCE.test(file)) {
      const text = readFileSync(file, "utf8");
      for (const re of SPECIFIERS) for (const m of text.matchAll(re)) check(file, m[1]);
    } else if (file.endsWith(".css")) {
      for (const m of readFileSync(file, "utf8").matchAll(CSS_IMPORT)) check(file, m[1]);
    }
  }
  const tsconfig = join(pluginDir, "tsconfig.json");
  if (existsSync(tsconfig)) {
    // tsconfig allows comments; the include array is all this reads.
    const include = /"include"\s*:\s*\[([^\]]*)\]/.exec(readFileSync(tsconfig, "utf8"));
    for (const m of (include?.[1] ?? "").matchAll(/"(\.\.\/[^"]+)"/g)) {
      if (!existsSync(resolve(pluginDir, m[1]))) miss(tsconfig, m[1], "is not in the copy");
    }
  }
}
if (misses > 0) {
  console.error(`${misses} relative path(s) a plugin needs are missing from its store copy`);
  process.exit(1);
}
