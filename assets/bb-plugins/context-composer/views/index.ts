// The views over one composition. Each meets views/types.ts; order is the tab order.
import { ListView } from "./list.tsx";
import { TreemapView } from "./treemap.tsx";
import type { View } from "./types.ts";

export const VIEWS: readonly View[] = [
  { id: "list", label: "List", component: ListView },
  { id: "treemap", label: "Treemap", component: TreemapView },
];
