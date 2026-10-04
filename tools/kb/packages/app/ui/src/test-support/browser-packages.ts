/**
 * The page's source: `@kb/ui` and every other `scope:browser` workspace
 * package the shell's Vite build compiles from source (the kit, and each
 * family's UI half). A test that holds "the UI" to a rule over its source
 * (a token is read, a colour has contrast, a geometry has one owner) reads
 * these, found by the scope tag each package already carries, so a package
 * that leaves `@kb/ui` stays under the rule.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** One browser package's source folder. */
export interface BrowserSource {
  readonly name: string;
  readonly src: string;
}

/** A package's name when its manifest tags it `scope:browser`; a folder with no manifest is no package. */
function browserPackageName(dir: string): string | undefined {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return undefined;
  const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof manifest !== "object" || manifest === null) return undefined;
  const nx = "nx" in manifest ? manifest.nx : undefined;
  const tags = typeof nx === "object" && nx !== null && "tags" in nx ? nx.tags : undefined;
  const browser = Array.isArray(tags) && tags.includes("scope:browser");
  const name = "name" in manifest ? manifest.name : undefined;
  return browser && typeof name === "string" ? name : undefined;
}

/** Every `scope:browser` workspace package, `@kb/ui` first. */
export function browserSources(): readonly BrowserSource[] {
  const out: BrowserSource[] = [];
  for (const layer of readdirSync(PACKAGES)) {
    const layerDir = path.join(PACKAGES, layer);
    if (!statSync(layerDir).isDirectory()) continue;
    for (const pkg of readdirSync(layerDir)) {
      const dir = path.join(layerDir, pkg);
      const name = browserPackageName(dir);
      if (name !== undefined) out.push({ name, src: path.join(dir, "src") });
    }
  }
  return out.toSorted((a, b) => (a.name === "@kb/ui" ? -1 : b.name === "@kb/ui" ? 1 : 0));
}

/** The source folder of one browser package, by name. */
export function browserSource(name: string): string {
  const found = browserSources().find((source) => source.name === name);
  if (found === undefined) throw new Error(`${name}: not a browser package`);
  return found.src;
}
