/**
 * The locations family's server entry (DESIGN.md → Locations): its actions
 * with their handlers, `ext.locations.*` with `location.*` aliases.
 */
import { extensionPlugin, type ExtensionAction } from "@kb/contracts";
import {
  locationForgetDef,
  locationListDef,
  locationRegisterDef,
  locationsExtension,
} from "@kb/locations";
import { locationForgetEffect, locationListEffect, locationRegisterEffect } from "./actions.ts";

const actions: ExtensionAction[] = [
  { ...locationListDef, effect: locationListEffect },
  { ...locationRegisterDef, effect: locationRegisterEffect },
  { ...locationForgetDef, effect: locationForgetEffect },
];

export const locationsPlugin = extensionPlugin({
  name: locationsExtension.name,
  actions,
  templates: [],
});
