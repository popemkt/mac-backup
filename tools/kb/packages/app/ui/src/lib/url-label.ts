/**
 * The short label a url value shows: where it goes, not how it is spelled.
 *
 * The scheme, a leading `www.` and a trailing slash are dropped, a long path
 * keeps its first and last segment around an ellipsis, and a `mailto:` link
 * shows its address. The full url is never lost: the link's `title` and the
 * browser's status bar carry it.
 */
const MAX = 48;

export function urlLabel(href: string): string {
  const mail = /^mailto:(.*)$/i.exec(href);
  if (mail) return mail[1] ?? href;
  const bare = href.replace(/^[a-z][a-z\d+.-]*:\/\//i, "").replace(/^www\./i, "");
  const trimmed = bare.replace(/\/$/, "");
  if (trimmed.length <= MAX) return trimmed;
  const [host = "", ...rest] = trimmed.split("/");
  const segments = rest.filter((s) => s !== "");
  if (segments.length >= 2) {
    const short = `${host}/${segments[0] ?? ""}/…/${segments.at(-1) ?? ""}`;
    if (short.length <= MAX) return short;
    return `${host}/…/${segments.at(-1) ?? ""}`.slice(0, MAX - 1) + "…";
  }
  return `${trimmed.slice(0, MAX - 1)}…`;
}
