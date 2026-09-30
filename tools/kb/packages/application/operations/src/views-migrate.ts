import { Effect } from "effect";
import { z } from "zod";
import { KbCtx, LegacyDocsViews, type ActionDefinition, type KbStore } from "@kb/contracts";
import { currentIso, diffTx, migrateToViewNodes, type DomainError } from "@kb/model";
import { persistEffect, reloadEffect } from "./session.ts";

/**
 * The move to view nodes, run on purpose (DESIGN.md → Kinds, roles and
 * options → View nodes): opening only reports that a store still needs it.
 */
export const viewsMigrateDef = {
  id: "views.migrate",
  title: "Migrate to view nodes",
  description:
    "Rewrite a store written before view nodes to them — graph perspectives, frames' sys.f.view.* settings and the root's .kb/views specs — retire the imported spec files, and report what it could not do",
  mode: { kind: "write" } as const,
  inputSchema: z.object({}),
  outputSchema: z.object({
    changed: z.boolean(),
    /** The docs views imported from `.kb/views`, by name; their files are removed. */
    imported: z.array(z.string()),
    /** One line for each thing left as it was, and why. */
    warnings: z.array(z.string()),
  }),
} satisfies ActionDefinition;

type ViewsMigrateOutput = z.infer<typeof viewsMigrateDef.outputSchema>;

export const viewsMigrateEffect = Effect.fn("views.migrate")(function* (): Effect.fn.Return<
  ViewsMigrateOutput,
  DomainError,
  KbCtx | KbStore | LegacyDocsViews
> {
  const ctx = yield* KbCtx;
  const legacy = yield* LegacyDocsViews;
  const files = yield* legacy.read;
  yield* reloadEffect(ctx);
  const before = ctx.nodes;
  const migration = migrateToViewNodes(before, { docs: files.views, at: yield* currentIso });
  if (migration.changed) yield* persistEffect(ctx, diffTx(before, migration.nodes));
  // Only once the nodes are committed: a spec file is never removed before its view node exists.
  yield* legacy.retire(migration.imported);
  return {
    changed: migration.changed,
    imported: [...migration.imported],
    warnings: [...files.skipped, ...migration.warnings],
  };
});
