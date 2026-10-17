/**
 * ⌘K "Open location…", the `sys.command` node the family seeds: it opens
 * the person's home store, whose own page lists every location in its
 * sidebar.
 *
 * GAP [[01M53VP7RKJG53B305MM26AYVG]]: the palette offers a command no list
 * of its own to pick from, so the command opens the picker as a page rather
 * than listing the rows in ⌘K.
 */
import { LOCATION_IDS } from "@kb/locations";
import { browserHost, type Command } from "@kb/ui-sdk";
import { openLocation } from "./open";

export const openLocationCommand: Command = {
  id: LOCATION_IDS.openCommand,
  scope: "global",
  run: async (ctx) => {
    ctx.palette.close();
    await openLocation(browserHost().invoke, {}, false);
  },
};
