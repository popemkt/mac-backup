/**
 * `extension.switch`: turn an optional family on or off for this store
 * (DESIGN.md → Extension families → optional is a server-side load
 * decision). It writes the family's switch node (`switchWrites`), so the
 * registry loads the family, or leaves it out, from the next call on, and
 * `kb.manifest` reports it so. It is the one way the switch is written: the
 * page's Preferences row calls it, and so may the CLI. It changes which code
 * the server loads, so the seeded approval policies ask an agent and deny
 * sandboxed code (DESIGN.md → Action registry → Approval).
 */
import { Effect } from "effect";
import { z } from "zod";
import {
  ExtensionCatalog,
  KbCtx,
  switchWrites,
  type ActionDefinition,
  type KbStore,
} from "@kb/contracts";
import { currentIso, domainError, type DomainError } from "@kb/model";
import { persistEffect, reloadEffect } from "./session.ts";

export const extensionSwitchDef = {
  id: "extension.switch",
  title: "Switch an extension",
  description:
    "Turn an optional extension (as kb.manifest lists it, optional: true) on or off for this kb: the server loads it, or leaves it out, from the next call on",
  mode: { kind: "write" } as const,
  inputSchema: z.object({ name: z.string().min(1), on: z.boolean() }),
  outputSchema: z.object({ name: z.string(), on: z.boolean() }),
} satisfies ActionDefinition;

export const extensionSwitchEffect = Effect.fn("extension.switch")(function* (
  input: z.infer<typeof extensionSwitchDef.inputSchema>,
): Effect.fn.Return<
  z.infer<typeof extensionSwitchDef.outputSchema>,
  DomainError,
  ExtensionCatalog | KbCtx | KbStore
> {
  const row = (yield* ExtensionCatalog).find((candidate) => candidate.name === input.name);
  if (row === undefined) {
    return yield* domainError("not_found", `no extension named ${input.name}`, {
      name: input.name,
    });
  }
  if (!row.optional) {
    return yield* domainError(
      "invalid_input",
      `${input.name} is not optional: it is on wherever it is loaded`,
      { name: input.name },
    );
  }
  const ctx = yield* KbCtx;
  // Read the switch as the store has it now: another process may have written it first.
  yield* reloadEffect(ctx);
  const upserts = switchWrites(row, input.on, (id) => ctx.index.getNode(id), yield* currentIso);
  yield* persistEffect(ctx, { upserts, deletes: [] });
  return { name: input.name, on: input.on };
});
