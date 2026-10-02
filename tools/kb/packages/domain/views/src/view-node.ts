/**
 * A proposed view node: a view, settings for it, and the node it is shown
 * for, checked and turned into the props a view node stores. DESIGN.md →
 * Kinds, roles and options → View nodes states what a proposal promises.
 */
import { Predicate, Result } from "effect";
import { SYSTEM_IDS, canonicalJson, type NodeId, type PropValue } from "@kb/model";
import { paramsIssues, type ViewIssue, type ViewKey } from "./view-key.ts";

/** A proposal that checks out: the settings as decoded, and the props that hold them. */
export interface ViewNodeProposal<P> {
  readonly key: ViewKey<P>;
  readonly params: P;
  /** The view node's props: the view it names (`sys.f.view`), then its settings. */
  readonly props: Record<NodeId, PropValue[]>;
}

/**
 * The view node that shows `key`'s view with `input` as its settings, for
 * `host` (the node it is shown for, null when none), or every issue that
 * stops it, each at its path. It is the one check of a proposed view:
 *
 * 1. `input` must be the view's params, every setting legal and none the view
 *    does not declare (`paramsIssues`, strict).
 * 2. The params are written as the view stores them (`config.write`), and the
 *    props must read back (`config.read`, for `host`) as those same params,
 *    with nothing reported. A setting the view takes from its host or its
 *    route instead of a view node, which a view node therefore cannot hold,
 *    is named here by its path.
 *
 * Nothing is written: the caller writes the props.
 */
export function viewNodeFor<P>(
  key: ViewKey<P>,
  input: unknown,
  host: NodeId | null,
): Result.Result<ViewNodeProposal<P>, readonly ViewIssue[]> {
  const params = paramsIssues(key, input, true);
  if (Result.isFailure(params)) return Result.fail(params.failure);
  const settings = key.config.write(params.success);
  const reported: string[] = [];
  const back = paramsIssues(
    key,
    key.config.read(settings, host, (warning) => reported.push(warning)),
  );
  const issues: ViewIssue[] = reported.map((message) => ({ path: [], message }));
  if (Result.isFailure(back))
    issues.push(...back.failure.map((issue) => unheld(key, issue.path, issue.message)));
  else issues.push(...differences(key, params.success, back.success));
  if (issues.length > 0) return Result.fail(issues);
  return Result.succeed({
    key,
    params: params.success,
    props: { [SYSTEM_IDS.viewField]: [{ t: "ref", v: key.option }], ...settings },
  });
}

/** A setting a view node of `key` cannot hold: what it reads back as instead. */
function unheld(key: ViewKey<unknown>, path: readonly string[], readsBack: string): ViewIssue {
  return {
    path,
    message: `a view node of ${key.id} cannot hold this setting; it reads back as: ${readsBack}`,
  };
}

/** Each top-level setting whose stored form reads back as something else. */
function differences(key: ViewKey<unknown>, asked: unknown, back: unknown): ViewIssue[] {
  if (!Predicate.isObject(asked) || !Predicate.isObject(back))
    return canonicalJson(asked) === canonicalJson(back)
      ? []
      : [unheld(key, [], canonicalJson(back))];
  return Object.keys(asked).flatMap((setting) =>
    canonicalJson(asked[setting]) === canonicalJson(back[setting])
      ? []
      : [
          unheld(
            key,
            [setting],
            back[setting] === undefined ? "nothing" : canonicalJson(back[setting]),
          ),
        ],
  );
}
