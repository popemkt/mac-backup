/**
 * The CLI's option parsers: each turns one argument into its value or throws
 * the usage error (exit {@link EXIT_USAGE}) commander reports for it.
 */
import { CommanderError } from "commander";

/** What a command exits with when it was called wrong. */
export const EXIT_USAGE = 2;

export const toInt = (v: string): number => Number.parseInt(v, 10);

/** A TCP port, 0 meaning any free one; anything else is a usage error, never NaN. */
export const toPort = (value: string): number => {
  const port = Number(value);
  if (/^\d+$/.test(value) && port <= 65535) return port;
  throw new CommanderError(
    EXIT_USAGE,
    "commander.invalidArgument",
    `a port is a whole number from 0 to 65535 (0: any free port), not ${value}`,
  );
};
export const toOrigin = (value: string): string => {
  try {
    const url = new URL(value);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    ) {
      return url.origin;
    }
  } catch {
    // Report malformed URLs through the same CLI usage error as non-origin URLs.
  }
  throw new CommanderError(
    EXIT_USAGE,
    "commander.invalidArgument",
    "--public-origin must be an HTTP(S) origin, e.g. https://kb.example.com",
  );
};
