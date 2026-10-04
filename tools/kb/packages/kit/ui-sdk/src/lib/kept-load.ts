/**
 * A failure that knows how to be tried again: what a view's error boundary
 * calls before it renders the view again ("Try again").
 */
export class RetryableError extends Error {
  readonly retry: () => void;

  constructor(cause: unknown, retry: () => void) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "RetryableError";
    this.retry = retry;
  }
}

/**
 * A value loaded once and kept: `current` is it once it has arrived, and
 * `load` is the one load in flight. A load that fails stays failed — so a
 * render that reads it again sees the failure rather than starting a load of
 * its own each time — and fails with a {@link RetryableError} whose `retry`
 * forgets it, so the next `load` asks again. That is what lets a view's "Try
 * again" fetch a chunk that failed to arrive, where `React.lazy` would rethrow
 * the first failure forever.
 */
export interface KeptLoad<T> {
  readonly current: () => T | null;
  readonly load: () => Promise<T>;
}

export function keptLoad<T>(load: () => Promise<T>): KeptLoad<T> {
  let value: T | null = null;
  let inFlight: Promise<T> | null = null;
  return {
    current: () => value,
    load: () => {
      if (inFlight !== null) return inFlight;
      const attempt: Promise<T> = load().then(
        (loaded) => {
          value = loaded;
          return loaded;
        },
        (error: unknown) => {
          throw new RetryableError(error, () => {
            if (inFlight === attempt) inFlight = null;
          });
        },
      );
      inFlight = attempt;
      return attempt;
    },
  };
}
