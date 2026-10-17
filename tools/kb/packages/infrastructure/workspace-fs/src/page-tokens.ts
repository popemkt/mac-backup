import { resolve } from "node:path";
import { Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { pageUrlOf } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";

/**
 * Where the person's own openers find a `kb ui`'s page token (DESIGN.md →
 * Surfaces → The page token): one file per server, under the person's home
 * store's `.kb/pages/`, readable by its owner only. A `kb ui` a person opened
 * writes it once it listens and removes it when it stops; an opener in
 * another process (`kb open`, and `location.open` for the sidebar) reads it
 * to hand a browser the page URL. It is never under a root a server serves,
 * so no server hands it out, and a program that reaches kb only over the
 * network reads no file at all. A file left by a server that died holds a
 * token no server takes.
 */
function pageTokenFile(home: string, url: string): string {
  const { hostname, port } = new URL(url);
  return resolve(pageTokensDir(home), `${hostname}-${port}.json`);
}

function pageTokensDir(home: string): string {
  return resolve(home, ".kb", "pages");
}

const PageTokenSchema = Schema.Struct({ url: Schema.String, token: Schema.String });

const decodePageToken = Schema.decodeUnknownOption(Schema.fromJsonString(PageTokenSchema));

const readPageToken = Effect.fn("kb.pageTokens.read")(function* (
  home: string,
  url: string,
): Effect.fn.Return<typeof PageTokenSchema.Type | null, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const text = yield* fs
    .readFileString(pageTokenFile(home, url))
    .pipe(
      Effect.catch((err) =>
        isNotFound(err) ? Effect.succeed(null) : Effect.fail(internal("read a page token", err)),
      ),
    );
  if (text === null) return null;
  const record = Option.getOrNull(decodePageToken(text));
  return record?.url === url ? record : null;
});

/** Keep `token`, the page token of the `kb ui` at `url`, for the person whose home is `home`. */
export const writePageToken = Effect.fn("kb.pageTokens.write")(function* (
  home: string,
  url: string,
  token: string,
): Effect.fn.Return<void, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const file = pageTokenFile(home, url);
  yield* fs.makeDirectory(pageTokensDir(home), { recursive: true, mode: 0o700 }).pipe(
    // The modes apply only to what this write creates; what was left behind keeps its own.
    Effect.andThen(fs.chmod(pageTokensDir(home), 0o700)),
    Effect.andThen(
      fs.writeFileString(file, `${JSON.stringify({ url, token })}\n`, { mode: 0o600 }),
    ),
    Effect.andThen(fs.chmod(file, 0o600)),
    Effect.mapError((err) => internal("write a page token", err)),
  );
});

/**
 * The URL that opens the `kb ui` at `url` as its page (`pageUrlOf`), from
 * the token it kept in `home`; null when it kept none.
 */
export const pageUrlFor = Effect.fn("kb.pageTokens.pageUrl")(function* (
  home: string,
  url: string,
): Effect.fn.Return<string | null, DomainError, FileSystem> {
  const record = yield* readPageToken(home, url);
  return record === null ? null : pageUrlOf(url, record.token);
});

/**
 * Forget the page token of the `kb ui` at `url`: remove its file, unless a
 * later server on the same port has since kept its own.
 */
export const clearPageToken = Effect.fn("kb.pageTokens.clear")(function* (
  home: string,
  url: string,
  token: string,
): Effect.fn.Return<void, DomainError, FileSystem> {
  const record = yield* readPageToken(home, url);
  if (record?.token !== token) return;
  const fs = yield* FileSystem;
  yield* fs
    .remove(pageTokenFile(home, url))
    .pipe(
      Effect.catch((err) =>
        isNotFound(err) ? Effect.void : Effect.fail(internal("remove a page token", err)),
      ),
    );
});
