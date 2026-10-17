/**
 * The design systems' stylesheets read as data: which tokens layer 1 and each
 * contributed system set, in their base and dark blocks, and the value a
 * token resolves to for one system and variant, the way the cascade resolves
 * it on `<html data-theme="<id>">`.
 *
 * It exists for the checks that hold the systems to their contract (the
 * design-system point's contract, contrast in `design-systems.test.ts`, the
 * lab's bloom bound in `lab-heat.test.ts`), so each reads the real CSS: layer
 * 1, and each system's sheet as its contribution carries it, rather than a
 * copy of its values. The caller hands in the CSS text; nothing here touches
 * the file system or the page.
 *
 * Every system is read the same way, the default included: its blocks are
 * the ones whose selector list names its id, wherever they sit. The default's
 * are layer 1's own (`:root, [data-theme="kb"]`), every other system's are in
 * its sheet.
 */
type Decls = ReadonlyMap<string, string>;
interface Block {
  readonly selector: string;
  readonly decls: Decls;
}
interface SystemSheet {
  /** The blocks of its own sheet, in order; none for a system that is layer 1. */
  readonly blocks: readonly Block[];
  /** Its base block's declarations: the block, here or in layer 1, that names its id. */
  readonly base: Decls;
  /** Its dark block's declarations, likewise. */
  readonly dark: Decls;
  /** How many blocks name its id as a base and as a dark block: exactly one each, for a sound system. */
  readonly named: { readonly base: number; readonly dark: number };
}
export type Variant = "light" | "dark";

/** A system's sheet as its contribution carries it. */
export interface SheetSource {
  readonly id: string;
  readonly stylesheet: string;
}

/** The selectors a system's two blocks carry. */
export const baseSelector = (id: string): string => `[data-theme="${id}"]`;
export const darkSelector = (id: string): string =>
  `.dark[data-theme="${id}"], .dark [data-theme="${id}"]`;
/** What layer 1 answers to with no system named: the page's ground before any paint. */
const ROOT_BASE = ":root";
const ROOT_DARK = ".dark";
const NONE: Decls = new Map();

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

/** The selectors in a block's selector list. */
function selectorsOf(block: Block): readonly string[] {
  return block.selector.split(",").map((selector) => selector.trim());
}

/** Whether `block` is a base block for `id`, a dark block for it, or neither. */
function roleOf(block: Block, id: string): "base" | "dark" | null {
  const selectors = selectorsOf(block);
  if (selectors.includes(baseSelector(id))) return "base";
  if (selectors.includes(`.dark ${baseSelector(id)}`)) return "dark";
  return null;
}

function rootBlock(blocks: readonly Block[], selector: string): Decls {
  const found = blocks.find((block) => selectorsOf(block).includes(selector));
  if (found === undefined) throw new Error(`layer 1 has no ${selector} block`);
  return found.decls;
}

export interface DesignSystemSheets {
  /** Layer 1 as the page has it with no system named: its `:root` and `.dark` blocks. */
  readonly layer1: { readonly base: Decls; readonly dark: Decls };
  /** Every system read, by id, in the order handed in. */
  readonly systems: ReadonlyMap<string, SystemSheet>;
  /** A token's value for one system and variant, `var()` references followed. */
  readonly resolve: (id: string, variant: Variant, token: string) => string;
}

/**
 * @param layer1Css `design-system.css`
 * @param systems every system's sheet, as its contribution carries it
 */
export function readDesignSystemSheets(
  layer1Css: string,
  systems: readonly SheetSource[],
): DesignSystemSheets {
  const layer1Blocks = blocksOf(layer1Css);
  const layer1 = {
    base: rootBlock(layer1Blocks, ROOT_BASE),
    dark: rootBlock(layer1Blocks, ROOT_DARK),
  };
  const read = new Map(
    systems.map(({ id, stylesheet }): [string, SystemSheet] => {
      const blocks = blocksOf(stylesheet);
      const naming = [...layer1Blocks, ...blocks].filter((block) => roleOf(block, id) !== null);
      const withRole = (role: "base" | "dark") =>
        naming.filter((block) => roleOf(block, id) === role);
      return [
        id,
        {
          blocks,
          base: withRole("base")[0]?.decls ?? NONE,
          dark: withRole("dark")[0]?.decls ?? NONE,
          named: { base: withRole("base").length, dark: withRole("dark").length },
        },
      ];
    }),
  );
  const resolve = (id: string, variant: Variant, token: string): string => {
    // Later layers win: layer 1, its dark set, the system, its dark set.
    const own = read.get(id);
    const layers = [
      layer1.base,
      variant === "dark" ? layer1.dark : null,
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
  return { layer1, systems: read, resolve };
}
