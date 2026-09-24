/**
 * The design-system stylesheets read as data: which tokens each system sets
 * in its base and dark blocks, and the value a token resolves to for one
 * system and variant, the way the cascade resolves it on `<html>`.
 *
 * It exists for the checks that hold the stylesheets to their contract
 * (completeness and contrast in `design-systems.test.ts`, the lab's bloom
 * bound in `embers/heat.test.ts`), so each reads the real CSS rather than a
 * copy of its values. The caller hands in the CSS text; nothing here touches
 * the file system.
 */
import { DEFAULT_DESIGN_SYSTEM, DESIGN_SYSTEM_IDS, type DesignSystemId } from "./theme";

export type Decls = ReadonlyMap<string, string>;
interface Block {
  readonly selector: string;
  readonly decls: Decls;
}
interface SystemSheet {
  readonly blocks: readonly Block[];
  readonly base: Decls;
  readonly dark: Decls;
}
export type Variant = "light" | "dark";

/** The selectors a non-default system's two blocks carry. */
export const baseSelector = (id: string): string => `[data-theme="${id}"]`;
export const darkSelector = (id: string): string =>
  `.dark[data-theme="${id}"], .dark [data-theme="${id}"]`;
/** The default's blocks also answer to its id, so a subtree can show it. */
const DEFAULT_BASE = `:root, ${baseSelector(DEFAULT_DESIGN_SYSTEM)}`;
const DEFAULT_DARK = `.dark, .dark ${baseSelector(DEFAULT_DESIGN_SYSTEM)}`;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Top-level rule blocks and their custom-property declarations. */
function blocksOf(css: string): Block[] {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => {
    const decls = new Map<string, string>();
    for (const decl of (m[2] ?? "").split(";")) {
      const at = decl.indexOf(":");
      const name = decl.slice(0, at).trim();
      if (at < 0 || !name.startsWith("--")) continue;
      decls.set(
        name,
        decl
          .slice(at + 1)
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
    return { selector: (m[1] ?? "").replace(/\s+/g, " ").trim(), decls };
  });
}

function block(blocks: readonly Block[], selector: string): Decls {
  const found = blocks.find((b) => b.selector === selector);
  if (found === undefined) throw new Error(`no block ${selector}`);
  return found.decls;
}

export interface DesignSystemSheets {
  readonly default: SystemSheet;
  /** Every non-default system, by id. */
  readonly systems: ReadonlyMap<DesignSystemId, SystemSheet>;
  /** A token's value for one system and variant, `var()` references followed. */
  readonly resolve: (id: DesignSystemId, variant: Variant, token: string) => string;
}

/**
 * @param defaultCss `design-system.css`
 * @param systemCss `design-systems/<id>.css` for every non-default id
 */
export function readDesignSystemSheets(
  defaultCss: string,
  systemCss: (id: DesignSystemId) => string,
): DesignSystemSheets {
  const defaultBlocks = blocksOf(defaultCss);
  const fallback: SystemSheet = {
    blocks: defaultBlocks,
    base: block(defaultBlocks, DEFAULT_BASE),
    dark: block(defaultBlocks, DEFAULT_DARK),
  };
  const systems = new Map(
    DESIGN_SYSTEM_IDS.filter((id) => id !== DEFAULT_DESIGN_SYSTEM).map(
      (id): [DesignSystemId, SystemSheet] => {
        const blocks = blocksOf(systemCss(id));
        return [
          id,
          { blocks, base: block(blocks, baseSelector(id)), dark: block(blocks, darkSelector(id)) },
        ];
      },
    ),
  );
  const resolve = (id: DesignSystemId, variant: Variant, token: string): string => {
    // Later layers win: the default, its dark set, the system, its dark set.
    const own = systems.get(id);
    const layers = [
      fallback.base,
      variant === "dark" ? fallback.dark : null,
      own?.base,
      variant === "dark" ? own?.dark : null,
    ];
    const lookup = (name: string, seen: readonly string[]): string => {
      const value = layers.findLast((l) => l?.has(name) === true)?.get(name);
      if (value === undefined) throw new Error(`${id}/${variant}: ${name} is not set`);
      const ref = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
      if (ref === undefined) return value;
      if (seen.includes(ref)) throw new Error(`${token}: reference cycle`);
      return lookup(ref, [...seen, name]);
    };
    return lookup(token, []);
  };
  return { default: fallback, systems, resolve };
}
