import { Effect } from "effect";
import { definePlugin } from "@kb/plugin";
import { locationsExtension } from "@kb/locations";
import { BrowserHostService, CommandPoint, SidebarSectionPoint } from "@kb/ui-sdk";
import { openLocationCommand } from "./command";
import { LocationsSection } from "./section";

/**
 * The locations family's page entry (DESIGN.md → Locations): the Locations
 * sidebar section, below Pinned, and ⌘K "Open location…". It loads only
 * while the server reports the family on, like every family's entry
 * (`ui-plugins.ts`). The family has no view, so there is no shared plugin to
 * load as a child.
 */
export const locationsUiPlugin = definePlugin({
  name: locationsExtension.name,
  inject: [BrowserHostService],
  apply: (ctx) =>
    Effect.all(
      [
        ctx.contribute(SidebarSectionPoint, {
          id: "section",
          value: { order: 110, Component: LocationsSection },
        }),
        ctx.contribute(CommandPoint, { id: openLocationCommand.id, value: openLocationCommand }),
      ],
      { discard: true },
    ),
});
