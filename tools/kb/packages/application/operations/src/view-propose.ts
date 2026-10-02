/**
 * `view.propose` — generative UI mode A (DESIGN.md → Kinds, roles and
 * options → View nodes): a caller, usually a model, names a view from
 * `kb.manifest`'s view catalog and settings for it, and kb writes the view
 * node, or says precisely why it cannot. The check is `@kb/views`'
 * `viewNodeFor`, the one check of a proposed view; this action only finds
 * the view and the host and writes what the check returns.
 */
import { Effect, Result } from "effect";
import { z } from "zod";
import { KbCtx, type ActionDefinition, type KbStore } from "@kb/contracts";
import {
  SYSTEM_IDS,
  currentIso,
  domainError,
  freshId,
  hostViewIds,
  type DomainError,
  type KbNode,
  type PropValue,
} from "@kb/model";
import { VIEW_CATALOG, catalogKeyOf, issueText, viewNodeFor } from "@kb/views";
import {
  assertNoSysUpsert,
  cloneNode,
  insertChild,
  placedRank,
  requireNode,
  syncDomain,
} from "./actions.ts";
import { persistEffect } from "./session.ts";

export const viewProposeDef = {
  id: "view.propose",
  title: "Propose view",
  description:
    "Write a view node: a view from kb.manifest's view catalog (`view`, its id or option), its settings (`params`, checked against that view's settings schema: every setting legal, none it does not declare, and each one a view node can hold), and optionally the node it is shown for (`host`), whose views then name it, first when `default`. Files it in the Views list. On any issue it writes nothing and fails with every issue at its path.",
  mode: { kind: "write" } as const,
  inputSchema: z.object({
    view: z.string().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
    host: z.string().min(1).optional(),
    /** The view node's text: its name (a docs view goes by it). */
    text: z.string().default(""),
    /** Make it the host's default view: first in its `sys.f.views`. */
    default: z.boolean().default(false),
    id: z.string().min(1).optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
    view: z.string(),
    host: z.string().optional(),
    params: z.unknown(),
    node: z.record(z.string(), z.unknown()),
  }),
} satisfies ActionDefinition;

type ViewProposeInput = z.infer<typeof viewProposeDef.inputSchema>;

const ref = (v: string): PropValue => ({ t: "ref", v });

/** The host with `viewId` among its views: last, or first when it is to be the default. */
function naming(host: KbNode, viewId: string, first: boolean, at: string): KbNode {
  const others = hostViewIds(host);
  const views = first ? [viewId, ...others] : [...others, viewId];
  const named = cloneNode(host);
  named.props[SYSTEM_IDS.viewsField] = views.map(ref);
  named.updatedAt = at;
  return named;
}

export const viewProposeEffect = Effect.fn("view.propose")(function* (
  input: ViewProposeInput,
): Effect.fn.Return<
  { id: string; view: string; host?: string; params: unknown; node: KbNode },
  DomainError,
  KbCtx | KbStore
> {
  const ctx = yield* KbCtx;
  const key = catalogKeyOf(input.view);
  if (key === null)
    return yield* domainError("invalid_input", `unknown view: ${input.view}`, {
      view: input.view,
      views: VIEW_CATALOG.map((known) => known.id),
    });
  const hostId = input.host;
  const host = hostId === undefined ? null : yield* syncDomain(() => requireNode(ctx, hostId));
  const proposal = viewNodeFor(key, input.params, host?.id ?? null);
  if (Result.isFailure(proposal))
    return yield* domainError(
      "invalid_input",
      `${key.id}: ${proposal.failure.map(issueText).join("; ")}`,
      { view: key.id, issues: proposal.failure },
    );

  const at = yield* currentIso;
  const id = input.id ?? (yield* freshId);
  if (ctx.index.getNode(id) !== undefined)
    return yield* domainError("ambiguous", `node id already exists: ${id}`, { id });
  // Filed at the end of the Views list, like every view node the UI makes; a
  // store without one files it at the forest roots.
  const list = ctx.index.getNode(SYSTEM_IDS.viewsList);
  const draft: KbNode = {
    id,
    text: input.text,
    props: proposal.success.props,
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  const node: KbNode = {
    ...draft,
    order: placedRank(ctx.nodes, list?.id ?? null, draft, undefined),
  };
  const upserts: KbNode[] = [node];
  if (list !== undefined) upserts.push(insertChild(list, id, at));
  if (host !== null) upserts.push(naming(host, id, input.default, at));
  yield* syncDomain(() => assertNoSysUpsert(upserts, false, "view.propose"));

  yield* persistEffect(ctx, { upserts, deletes: [] });
  return {
    id,
    view: key.id,
    ...(host === null ? {} : { host: host.id }),
    params: proposal.success.params,
    node,
  };
});
