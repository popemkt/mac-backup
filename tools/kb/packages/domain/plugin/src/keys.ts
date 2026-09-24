/**
 * The three kinds of name a plugin can share with another: a service it
 * provides or injects, an event it emits or listens to, and a point it
 * contributes to. A key is a name plus a type the name stands for; the type
 * lives only in the compiler (`~type` is never set), so a key is plain data.
 *
 * Keys are compared by identity, not by name: two keys spelled alike but
 * created apart are a conflict the kernel reports, never a silent alias. So a
 * key is created once, by the package that owns the concept, and imported by
 * everyone who uses it — which is also what makes the phantom type honest.
 */
export interface Key<Kind extends string, T> {
  readonly kind: Kind;
  readonly name: string;
  readonly "~type"?: T;
}

/** An implementation one plugin provides and others inject by this key. */
export type ServiceKey<S> = Key<"service", S>;

/** A payload type broadcast to every listener of this key. */
export type EventKey<P> = Key<"event", P>;

/**
 * A place contributions collect: actions, render templates, UI surfaces. Each
 * contribution carries an id unique within the point.
 */
export type PointKey<C> = Key<"point", C>;

/** Any key, whatever it stands for — for lists such as a plugin's `inject`. */
export type AnyServiceKey = Key<"service", unknown>;

export function Service<S>(): (name: string) => ServiceKey<S> {
  return (name) => ({ kind: "service", name });
}

export function Event<P>(): (name: string) => EventKey<P> {
  return (name) => ({ kind: "event", name });
}

export function Point<C>(): (name: string) => PointKey<C> {
  return (name) => ({ kind: "point", name });
}

/**
 * Read a value stored under `key` as the type `key` stands for.
 *
 * The kernel keeps services, contributions and listeners in maps of
 * `unknown`, because one map holds every key's values. What makes the read
 * sound is that the only writes are typed by the same key object, checked by
 * identity on the way in — so this is the one place that trust is spent.
 */
export function asKeyType<T>(_key: Key<string, T>, value: unknown): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the kernel's one trust: every write under this key was typed by this same key object
  return value as T;
}
