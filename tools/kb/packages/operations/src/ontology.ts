/**
 * `ontology.members` — the one new registry action the ontology core needs.
 *
 * Everything mutating is already expressible as `node.add` / `node.update`;
 * the resolver is the only thing not expressible as a single datalog query, so
 * it gets a surface. This keeps the INSPIRATIONS.md rule intact: anything the
 * UI does is reachable through data. The UI's scope is exactly
 * `kb ontology members <id>`.
 *
 * Lives in its own module (not `operations/index.ts`) so the ontology wave adds
 * a file instead of editing a 700-line shared one.
 */
import { Effect } from "effect";
import { z } from "zod";
import type { ActionDefinition } from "@kb/contracts";
import { domainError, type DomainError } from "@kb/model";
import { KbCtx } from "@kb/contracts";
import type { KbContext } from "@kb/contracts";
import { query } from "@kb/query";
import {
  isOntologyNode,
  resolveOntology,
  type MemberReason,
} from "@kb/model";

const MemberReasonSchema = z.object({
  kind: z.enum(["member", "tag", "query", "extends", "closure"]),
  via: z.string().optional(),
});

export const ontologyMembersDef = {
  id: "ontology.members",
  title: "Resolve ontology members",
  description:
    "Resolve an #ontology node's membership (tags + pins + query + extends, minus excludes)",
  mode: "read" as const,
  inputSchema: z.object({
    id: z.string(),
    /** Include per-member provenance ("why am I here?"). */
    reasons: z.boolean().optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    members: z.array(z.string()),
    reasons: z.record(z.string(), z.array(MemberReasonSchema)).optional(),
    excluded: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
} satisfies ActionDefinition;

/** Adapt the backend datalog runner to the resolver's row contract. */
function ednRunner(ctx: KbContext): (edn: string) => unknown[][] {
  return (edn) => {
    const raw = query(ctx.qdb, edn);
    const list =
      raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : [];
    return list.map((row) => (Array.isArray(row) ? row : [row]));
  };
}

export const ontologyMembersEffect = Effect.fn("ontology.members")(
  function* (
    input: z.infer<typeof ontologyMembersDef.inputSchema>,
  ): Effect.fn.Return<
    z.infer<typeof ontologyMembersDef.outputSchema>,
    DomainError,
    KbCtx
  > {
    const ctx = yield* KbCtx;
    const node = ctx.nodes.find((n) => n.id === input.id);
    if (!node) {
      return yield* domainError("not_found", `node not found: ${input.id}`, {
        id: input.id,
      });
    }
    if (!isOntologyNode(node)) {
      return yield* domainError(
        "invalid_input",
        `node is not tagged #ontology: ${input.id}`,
        { id: input.id },
      );
    }

    const resolution = resolveOntology(ctx.nodes, input.id, {
      runQuery: ednRunner(ctx),
    });
    const members = [...resolution.members].sort();
    const out: z.infer<typeof ontologyMembersDef.outputSchema> = {
      id: input.id,
      members,
      excluded: [...resolution.excluded].sort(),
      warnings: resolution.warnings,
    };
    if (input.reasons === true) {
      const reasons: Record<string, MemberReason[]> = {};
      for (const id of members) {
        reasons[id] = resolution.reasons.get(id) ?? [];
      }
      out.reasons = reasons;
    }
    return out;
  },
);
