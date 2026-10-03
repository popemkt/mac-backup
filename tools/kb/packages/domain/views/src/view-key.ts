/**
 * What a view is as data: its key. Nothing here knows the plugin kernel,
 * React or a store, so the UI that draws a view and the server that lists,
 * validates and renders it hold the one same key. How a view is contributed
 * and drawn is the UI's (`@kb/ui`'s `lib/plugins.ts`); the contract of both is
 * stated once, in DESIGN-UI.md → UI points: routes and views.
 */
import { Result, Schema, SchemaIssue } from "effect";
import {
  viewOptionId,
  type NodeId,
  type NodeProps,
  type PropValue,
  type ViewFamily,
} from "@kb/model";

/**
 * A view's name and the params it renders from. Made once, in this package,
 * and compared by identity, like `Service`/`Point` keys: a key
 * spelled alike but created elsewhere is a different key.
 */
export interface ViewKey<P> {
  readonly kind: "view";
  /** `<namespace>.<local id>`: the namespace of what draws it (a UI plugin, or the server's render layer for docs), then the view's id. */
  readonly id: `${string}.${string}`;
  /**
   * What the view is called: its option node's text under `sys.views`, which
   * the seed derives from this key, and what a picker or a pane title names
   * it by.
   */
  readonly label: string;
  /**
   * What a legal `P` is: the view's settings, as an Effect `Schema`. It is the
   * one statement of them — a host decodes stored config through it, a picker
   * asks it which settings the view reads, and the contract decodes the
   * view's `sample` with it. It also carries `P` for the compiler.
   */
  readonly params: Schema.Decoder<P>;
  /**
   * The family of views a host chooses between by config, when the view is
   * one of them (`graph.renderer`, `outline.frame`): the discriminant a
   * family's key extends `ViewKey` under. A view no host picks has none. Its
   * option node carries the family's node (`sys.f.view.family`), which the
   * seed derives from this key too.
   */
  readonly family?: ViewFamily;
  /**
   * The option node that names this view in data (`sys.view.<id>`), which a
   * view node's `sys.f.view` refers to. Derived from the id, so a key and the
   * store name one view one way.
   */
  readonly option: string;
  /**
   * How the view's settings are stored on a view node: read from its props
   * into what `params` decodes, and written back from params to props.
   */
  readonly config: ViewConfigCodec<P>;
}

/** Where a config reader sends a stored prop it had to ignore. */
export type ConfigReport = (warning: string) => void;

/**
 * How a key stores its params on a view node (`ViewKey.config`).
 *
 * `read` takes a node's props, and the node the view is shown for (`host`,
 * null when there is none), into the input its params decode from. A prop it
 * cannot read is reported, never thrown: where the report goes is the
 * caller's to decide (the UI logs it).
 *
 * `write` is the inverse: the props a view node holds `params` as. What a
 * view stores, `read` reads back as the same params; a setting it does not
 * store (one its host or its route supplies) is written as nothing, and
 * reads back as whatever the node it is shown for gives. `viewNodeFor` holds
 * a proposal to that round trip.
 */
export interface ViewConfigCodec<P> {
  read(props: NodeProps, host: string | null, report: ConfigReport): unknown;
  write(params: P): Record<NodeId, PropValue[]>;
}

/** The params a key's view renders from. */
export type ParamsOf<K> = K extends ViewKey<infer P> ? P : never;

/** The params of a view that renders from nothing but the store (the outline, a list). */
export const NoParams = Schema.Struct({});
export type NoParams = typeof NoParams.Type;

/** A key that belongs to no family: a view no host picks between (a page, an embed). */
export type PlainViewKey<P> = ViewKey<P> & { readonly family?: undefined };

/** A view whose settings nothing stores: it reads no props and writes none. */
const STORES_NOTHING: ViewConfigCodec<never> = { read: () => ({}), write: () => ({}) };

export function viewKey<P>(
  id: `${string}.${string}`,
  label: string,
  params: Schema.Decoder<P>,
  config: ViewConfigCodec<P> = STORES_NOTHING,
): PlainViewKey<P> {
  return { kind: "view", id, label, params, option: viewOptionId(id), config };
}

/**
 * The local id a contribution under `key` takes: the key's id past its
 * namespace. It is also the name a view goes by in config stored as text
 * (`sys.f.view.mode`, `lens.renderer`), so that name resolves to the key.
 */
export function localIdOf(key: ViewKey<unknown>): string {
  return key.id.slice(key.id.indexOf(".") + 1);
}

/**
 * `input` read as `key`'s params: how a host turns stored config into the
 * `P` it renders the view with. Only the settings the key declares are kept,
 * and every issue it cannot read is the failure's message, one line each
 * ({@link paramsIssues}, {@link issueText}).
 */
export function paramsFrom<P>(key: ViewKey<P>, input: unknown): Result.Result<P, string> {
  return Result.mapError(paramsIssues(key, input), (issues) => issues.map(issueText).join("; "));
}

/** One thing wrong with a view's params: where (a path into them) and what. */
export interface ViewIssue {
  readonly path: readonly string[];
  readonly message: string;
}

const STANDARD_ISSUES = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * `input` read as `key`'s params, or every issue that stops it, each at its
 * path. `strict` refuses a setting the view does not declare, which a host
 * reading stored config ignores (`paramsFrom`) but a caller proposing params
 * has to be told about.
 */
export function paramsIssues<P>(
  key: ViewKey<P>,
  input: unknown,
  strict = false,
): Result.Result<P, readonly ViewIssue[]> {
  const decoded = Schema.decodeUnknownResult(key.params, {
    onExcessProperty: strict ? "error" : "ignore",
    errors: "all",
  })(input);
  if (Result.isSuccess(decoded)) return Result.succeed(decoded.success);
  return Result.fail(
    STANDARD_ISSUES(decoded.failure.issue).issues.map((issue) => ({
      path: (issue.path ?? []).map((segment) =>
        String(typeof segment === "object" ? segment.key : segment),
      ),
      message: issue.message,
    })),
  );
}

/** An issue as one line: its path, then what is wrong there. */
export function issueText(issue: ViewIssue): string {
  return issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`;
}

/**
 * The params `key` renders from when shown from stored `props` for `host`:
 * read through the key's `config`, then decoded by its `params`.
 */
export function paramsFromProps<P>(
  key: ViewKey<P>,
  props: NodeProps,
  host: string | null,
  report: ConfigReport,
): Result.Result<P, string> {
  return paramsFrom(key, key.config.read(props, host, report));
}
