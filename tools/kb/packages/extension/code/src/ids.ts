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
} as const;
