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
import {
  KbCtx,
  ViewCatalog,
  type ActionDefinition,
  type KbContext,
  type KbStore,
} from "@kb/contracts";
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
import { issueText, viewNodeFor, type ViewKey } from "@kb/views";
import {
  cloneNode,
  insertChild,
  placedRank,
  sessionGraph,
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

/** What a view proposal asks for: the view's settings, the node it is shown for, and the node's own. */
export interface ViewProposal {
  readonly params: unknown;
  readonly host?: string | undefined;
  readonly text: string;
  /** First among the host's views, so its default. */
  readonly default: boolean;
  readonly id?: string | undefined;
}

/** A planned view node: the node, what it checked as, and the tx that writes it. */
export interface PlannedView {
  readonly node: KbNode;
  readonly host: KbNode | null;
  readonly params: unknown;
  readonly upserts: readonly KbNode[];
}

/**
 * The write a view proposal makes, planned over the session's graph as it
 * reads now: the view node `viewNodeFor` checks, filed at the end of the
 * Views list (a store without one files it at the forest roots), and the
 * host with it among its views. Every writer of a view node from settings
 * plans it here, so each writes what an agent's `view.propose` would.
 */
export const planViewProposal = Effect.fn("view.propose.plan")(function* (
  ctx: KbContext,
  key: ViewKey<unknown>,
  proposal: ViewProposal,
): Effect.fn.Return<PlannedView, DomainError> {
  const hostId = proposal.host;
  const host = hostId === undefined ? null : yield* syncDomain(() => requireNode(ctx, hostId));
  const checked = viewNodeFor(key, proposal.params, host?.id ?? null);
  if (Result.isFailure(checked))
    return yield* domainError(
      "invalid_input",
      `${key.id}: ${checked.failure.map(issueText).join("; ")}`,
      { view: key.id, issues: checked.failure },
    );

  const at = yield* currentIso;
  const id = proposal.id ?? (yield* freshId);
  if (ctx.index.getNode(id) !== undefined)
    return yield* domainError("ambiguous", `node id already exists: ${id}`, { id });
  const list = ctx.index.getNode(SYSTEM_IDS.viewsList);
  const draft: KbNode = {
    id,
    text: proposal.text,
    props: checked.success.props,
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  const node: KbNode = {
    ...draft,
    order: placedRank(sessionGraph(ctx), list?.id ?? null, draft, undefined),
  };
  const upserts: KbNode[] = [node];
  if (list !== undefined) upserts.push(insertChild(list, id, at));
  if (host !== null) upserts.push(naming(host, id, proposal.default, at));
  return { node, host, params: checked.success.params, upserts };
});

export const viewProposeEffect = Effect.fn("view.propose")(function* (
  input: ViewProposeInput,
): Effect.fn.Return<
  { id: string; view: string; host?: string; params: unknown; node: KbNode },
  DomainError,
  KbCtx | KbStore | ViewCatalog
> {
  const ctx = yield* KbCtx;
  const catalog = yield* ViewCatalog;
  const key = catalog.keyOf(input.view);
  if (key === null)
    return yield* domainError("invalid_input", `unknown view: ${input.view}`, {
      view: input.view,
      views: catalog.items.map((known) => known.key.id),
    });
  const planned = yield* planViewProposal(ctx, key, input);
  yield* persistEffect(ctx, { upserts: [...planned.upserts], deletes: [] });
  return {
    id: planned.node.id,
    view: key.id,
    ...(planned.host === null ? {} : { host: planned.host.id }),
    params: planned.params,
    node: planned.node,
  };
});
