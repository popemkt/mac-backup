/**
 * What a view is as data: its key, and what a picker names it by. Nothing here
 * knows the plugin kernel, React or a store, so a key file (`view-keys` zone)
 * and the store's row walk can hold keys without pulling either in. How views
 * are contributed and rendered is `lib/plugins.ts`; the contract of both is
 * stated once, in DESIGN-UI.md → UI points: routes and views.
 */
import type { Icon, IconWeight } from "@phosphor-icons/react";
import { Result, Schema } from "effect";

/**
 * A view's name and the params it renders from. Made once by the plugin that
 * owns the view and compared by identity, like `Service`/`Point` keys: a key
 * spelled alike but created elsewhere is a different key.
 */
export interface ViewKey<P> {
  readonly kind: "view";
  /** `<namespace>.<local id>`: the owning plugin's namespace, then the view's id. */
  readonly id: `${string}.${string}`;
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
   * family's key extends `ViewKey` under. A view no host picks has none.
   */
  readonly family?: string;
}

/** The params a key's view renders from. */
export type ParamsOf<K> = K extends ViewKey<infer P> ? P : never;

/** The params of a view that renders from nothing but the store (the outline, a list). */
export const NoParams = Schema.Struct({});
export type NoParams = typeof NoParams.Type;

export function viewKey<P>(id: `${string}.${string}`, params: Schema.Decoder<P>): ViewKey<P> {
  return { kind: "view", id, params };
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
 * and one it cannot read is the failure's message.
 */
export function paramsFrom<P>(key: ViewKey<P>, input: unknown): Result.Result<P, string> {
  const decoded = Schema.decodeUnknownResult(key.params)(input);
  return Result.isSuccess(decoded)
    ? Result.succeed(decoded.success)
    : Result.fail(decoded.failure.message);
}

/**
 * How a picker names a view of a family: part of the view's contribution, not
 * of its key, because it is presentation. `order` is where it sits among its
 * family (lower first); `glyph` is the toolbar's text mark, `icon` the menu's,
 * and `command` the `sys.command` node that switches to it, where the family
 * has those.
 */
export interface ViewPicker {
  readonly label: string;
  readonly order: number;
  readonly glyph?: string;
  readonly icon?: Icon;
  readonly iconWeight?: IconWeight;
  readonly command?: string;
}

/** One view of a family as a picker lists it: its key, and how it is named. */
export interface FamilyView<K extends ViewKey<unknown>> {
  readonly key: K;
  readonly picker: ViewPicker;
}
