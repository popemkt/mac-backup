/**
 * The locations family's shared package (DESIGN.md → Locations): its
 * declaration, the frozen ids of what it keeps in the home store, what each
 * of its actions writes there, and the actions as every surface lists them.
 * The server's entry (`@kb/locations-fs`) handles them; the page draws their
 * rows.
 */
export { locationsExtension } from "./extension.ts";
export { LOCATION_IDS } from "./ids.ts";
export {
  forgetWrites,
  locationEntries,
  registerWrites,
  type LocationEntry,
  type LocationWrite,
} from "./writes.ts";
export {
  LOCATION_ACTIONS,
  LOCATION_STATUSES,
  LocationListSchema,
  LocationOpenedSchema,
  LocationRowSchema,
  locationForgetDef,
  locationListDef,
  locationOpenDef,
  locationRegisterDef,
  type LocationList,
  type LocationOpened,
  type LocationRow,
} from "./actions.ts";
