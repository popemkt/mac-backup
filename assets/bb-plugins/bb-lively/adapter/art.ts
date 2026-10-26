// The person's art image, when it is a file on the machine bb runs on: the
// window cannot read a local path, so server.ts serves the one file the
// `artImage` setting names, at `/api/v1/plugins/bb-lively/http/art`. Only
// that file, only an image type, at most ART_MAX_BYTES; never committed
// anywhere (the setting lives in bb's database).
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join } from "node:path";

export const ART_MAX_BYTES = 20 * 1024 * 1024;

const TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

/** The setting's value as an absolute file path, or undefined when it is not a path (empty, a URL). */
export function artPath(value: string, home: string = homedir()): string | undefined {
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return isAbsolute(value) ? value : undefined;
}

const notFound = (why: string) => new Response(why, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function artResponse(value: string): Promise<Response> {
  const path = artPath(value);
  if (path === undefined) return notFound("no art image file is set");
  const type = TYPES[extname(path).toLowerCase()];
  if (type === undefined) return notFound("the art image is not a png, jpg, webp, gif, avif or svg file");
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > ART_MAX_BYTES) return notFound("the art image is not a file, or is over 20 MB");
    return new Response(new Uint8Array(await readFile(path)), {
      headers: {
        "content-type": type,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
        // An SVG is shown as a background image, where it cannot run script; this also keeps it inert if opened directly.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      },
    });
  } catch {
    return notFound("the art image file cannot be read");
  }
}
