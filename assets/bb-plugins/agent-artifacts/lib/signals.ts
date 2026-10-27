// Realtime signals server.ts publishes and app.tsx listens for. Kept apart from server.ts so the frontend bundle
// imports only these names.

/** A thread's inventory was rebuilt. Chips and panels showing that thread fetch it again. */
export const INVENTORY_CHANNEL = "inventory";
export type InventorySignal = { threadId: string; builtAt: number };

/** A workspace's Claude Code probe finished. Panels on that workspace fetch it again. */
export const CLAUDE_CHANNEL = "claude";
export type ClaudeSignal = { hostId: string; path: string };
