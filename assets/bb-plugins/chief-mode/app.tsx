// chief-mode's frontend: one "Chief" page beside bb's own thread list (a navPanel, never the
// exclusive thread-list slot), with a badge counting members that wait on a person.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ChiefPage, useChiefBadge } from "./ui/ChiefPage.tsx";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "chief",
    title: "Chief",
    icon: "Workflow",
    path: "chief",
    component: ChiefPage,
    experimental_useBadge: useChiefBadge,
  });
});
