/**
 * The code family's system ids (DESIGN.md → Extension families → ids are
 * frozen data). They kept their spelling when they left core's table, so a
 * store seeded before the move opens without a write.
 */
export const CODE_IDS = {
  /**
   * A code view's code, as it is run (text, single), and the grant it runs
   * under, as canonical JSON (text, single). DESIGN.md → View nodes → Code
   * views.
   */
  codeField: "sys.f.code",
  codeGrantField: "sys.f.code.grant",
  /**
   * The `#script` tag: a node tagged with it is code that adds behaviour to
   * a view, kept in the two fields above (DESIGN.md → Sandbox → Scripts).
   * It configures the code family, so writing a script is configuration.
   */
  scriptTag: "sys.tag.script",
  /** A node's scripts: the `#script` nodes run for it while a view shows it (ref, many). */
  scriptsField: "sys.f.scripts",
} as const;
